using System.Text.Json;
using System.Text.Json.Nodes;
using MySql.Data.MySqlClient;
using PaCT.Api.Consultations;

namespace PaCT.Api.Clients;

public sealed record ClientAggregationItem(string Area, string RecordId, string FromPersonId, string ToPersonId);

// Only an explicit, verified identity decision calls this ownership reassignment.
internal static class ClientAggregation
{
    internal static Dictionary<string, string> ReadOwners(IEnumerable<(string Account, string Person)> accounts, IEnumerable<(string Source, string Target)> associations)
    {
        var links = associations.GroupBy(link => link.Source).Where(group => group.Select(link => link.Target).Distinct().Count() == 1)
            .ToDictionary(group => group.Key, group => group.First().Target);
        return accounts.ToDictionary(account => account.Account, account => {
            var person = account.Person; var visited = new HashSet<string>();
            while (links.TryGetValue(person, out var target)) { if (!visited.Add(person)) return account.Person; person = target; }
            return person;
        });
    }

    internal static async Task<Dictionary<string, string>> LoadReadOwnersAsync(MySqlConnection connection, MySqlTransaction transaction, CancellationToken ct)
    {
        var links = new List<(string Source, string Target)>(); var accounts = new List<(string Account, string Person)>();
        await using (var command = new MySqlCommand("""
            SELECT r.associated_person_id,r.person_id FROM client_reviews r JOIN people p ON p.id=r.associated_person_id
            WHERE r.status='Accepted' AND p.is_active=0 AND r.person_id<>r.associated_person_id
            """, connection, transaction))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) links.Add((reader.GetGuid(0).ToString(), reader.GetGuid(1).ToString()));
        await using (var command = new MySqlCommand("SELECT id,origin_person_id FROM accounts WHERE role='Client'", connection, transaction))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) accounts.Add((reader.GetGuid(0).ToString(), reader.GetGuid(1).ToString()));
        return ReadOwners(accounts, links);
    }

    private static readonly (string Table, bool PersonColumn)[] Tables = [
        ("consultations", true), ("guest_consultation_requests", true), ("credit_entries", true),
        ("session_packs", true), ("pack_uses", true), ("pack_notices", true), ("event_participations", true),
        ("consultation_notices", false), ("event_notices", false), ("balance_notices", true), ("group_events", false)
    ];

    internal static string? ReassignJson(string json, string table, string source, string target)
    {
        var row = JsonNode.Parse(json)!.AsObject(); var changed = row["PersonId"]?.GetValue<string>() == source;
        if (changed) row["PersonId"] = target;
        if (table == "group_events" && row["Definition"]?["AllowedPersonIds"] is JsonArray allowed
            && allowed.Any(value => value?.GetValue<string>() == source))
        {
            row["Definition"]!["AllowedPersonIds"] = new JsonArray(allowed.Select(value => value!.GetValue<string>() == source ? target : value.GetValue<string>())
                .Distinct(StringComparer.Ordinal).Select(value => (JsonNode?)JsonValue.Create(value)).ToArray());
            changed = true;
        }
        if (!changed) return null;
        if (row["Version"] is JsonValue version && version.TryGetValue<long>(out var previous)) row["Version"] = previous + 1;
        return row.ToJsonString();
    }

    internal static async Task<ClientAggregationItem[]> ReassignAsync(MySqlConnection connection, MySqlTransaction transaction,
        string source, string target, DateTime now, CancellationToken ct)
    {
        var present = new HashSet<string>(StringComparer.Ordinal);
        await using (var command = new MySqlCommand("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()", connection, transaction))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) present.Add(reader.GetString(0));
        var items = new List<ClientAggregationItem>();
        foreach (var (table, personColumn) in Tables.Where(value => present.Contains(value.Table)))
        {
            var updates = new List<(string Id, string Json)>();
            var predicate = table == "group_events" ? "JSON_CONTAINS(JSON_EXTRACT(data,'$.Definition.AllowedPersonIds'),JSON_QUOTE(@source))"
                : personColumn ? "person_id=@source" : "JSON_UNQUOTE(JSON_EXTRACT(data,'$.PersonId'))=@source";
            await using (var command = new MySqlCommand("SELECT id,data FROM " + table + " WHERE " + predicate + " ORDER BY id FOR UPDATE", connection, transaction))
            {
                command.Parameters.AddWithValue("@source", source);
                await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                    if (ReassignJson(reader.GetString(1), table, source, target) is { } json) updates.Add((reader.GetGuid(0).ToString(), json));
            }
            foreach (var (id, json) in updates)
            {
                await using var update = new MySqlCommand("UPDATE " + table + " SET data=@data" + (personColumn ? ",person_id=@target" : "") + " WHERE id=@id", connection, transaction);
                update.Parameters.AddWithValue("@data", json); update.Parameters.AddWithValue("@id", id);
                if (personColumn) update.Parameters.AddWithValue("@target", target);
                if (await update.ExecuteNonQueryAsync(ct) != 1) throw new InvalidOperationException("The aggregation record changed.");
                items.Add(new(table, id, source, target));
            }
        }
        await using (var notes = new MySqlCommand("SELECT id FROM client_notes WHERE person_id=@source ORDER BY id FOR UPDATE", connection, transaction))
        {
            notes.Parameters.AddWithValue("@source", source); await using var reader = await notes.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) items.Add(new("client_notes", reader.GetGuid(0).ToString(), source, target));
        }
        await using (var notes = new MySqlCommand("UPDATE client_notes SET person_id=@target WHERE person_id=@source", connection, transaction))
        { notes.Parameters.AddWithValue("@target", target); notes.Parameters.AddWithValue("@source", source); await notes.ExecuteNonQueryAsync(ct); }
        if (present.Contains("balance_notices") && present.Contains("credit_entries"))
        {
            var alerts = new List<BalanceNotice>();
            await using (var read = new MySqlCommand("SELECT data FROM balance_notices WHERE person_id=@target ORDER BY id FOR UPDATE", connection, transaction))
            {
                read.Parameters.AddWithValue("@target", target); await using var reader = await read.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct)) alerts.Add(JsonSerializer.Deserialize<BalanceNotice>(reader.GetString(0))!);
            }
            decimal balance;
            await using (var read = new MySqlCommand("SELECT COALESCE(SUM(amount),0) FROM credit_entries WHERE person_id=@target", connection, transaction))
            { read.Parameters.AddWithValue("@target", target); balance = Convert.ToDecimal(await read.ExecuteScalarAsync(ct)); }
            var active = alerts.Where(notice => notice.ClosedAt is null).OrderBy(notice => notice.CreatedAt).ThenBy(notice => notice.Id).ToArray();
            for (var i = 0; i < active.Length; i++)
            {
                var value = active[i] with { Amount = Math.Max(0, -balance), UpdatedAt = new(now, TimeSpan.Zero), ClosedAt = i > 0 || balance >= 0 ? new(now, TimeSpan.Zero) : null };
                await using var update = new MySqlCommand("UPDATE balance_notices SET data=@data WHERE id=@id", connection, transaction);
                update.Parameters.AddWithValue("@data", JsonSerializer.Serialize(value)); update.Parameters.AddWithValue("@id", value.Id); await update.ExecuteNonQueryAsync(ct);
            }
        }
        return items.ToArray();
    }
}
