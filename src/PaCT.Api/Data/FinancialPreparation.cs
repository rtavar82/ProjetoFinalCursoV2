using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

// Explicit preparation of stored summaries, never an automatic financial operation at startup.
public static class FinancialPreparation
{
    private static readonly string[] Tables = ["consultations", "event_participations", "group_events"];
    private sealed record Row(string Table, string Id, string Before, string After);
    private sealed record Plan(Row[] Rows, string[] Issues);

    internal static string Upgrade(string table, string json, CreditEntry[] entries)
    {
        if (table == "group_events")
        {
            var ev = JsonNode.Parse(json)!.AsObject(); var changed = false;
            void RemoveUnusedPlan(JsonObject? definition)
            {
                if (definition is null) return;
                if (definition["Installments"] is JsonArray { Count: > 0 })
                    throw new InvalidOperationException("Existe um plano de pagamentos antigo que precisa de ser preservado e revisto antes da alteração.");
                changed |= definition.Remove("PaymentPlan"); changed |= definition.Remove("Installments");
            }
            RemoveUnusedPlan(ev["Definition"] as JsonObject);
            foreach (var history in ev["History"] as JsonArray ?? [])
            { RemoveUnusedPlan(history?["Before"] as JsonObject); RemoveUnusedPlan(history?["After"] as JsonObject); }
            if (!changed) return json;
            ev["Version"] = (ev["Version"]?.GetValue<long>() ?? 1) + 1;
            return ev.ToJsonString();
        }
        var row = JsonNode.Parse(json)!.AsObject(); var id = row["Id"]!.GetValue<string>();
        var person = row["PersonId"]?.GetValue<string>();
        var applicable = entries.Where(e => e.Kind == "Settlement" && (table == "consultations"
            ? e.ConsultationId == id : e.Origin == "EventService" && e.OriginReference == id)).ToArray();
        if (applicable.Any(e => e.PersonId != person || e.Amount >= 0)) throw new InvalidOperationException("Liquidação com cliente ou valor incompatível.");
        var amount = -applicable.Sum(e => e.Amount);
        var final = row["FinalAmount"]?.GetValue<decimal>() ?? row["AgreedTotal"]?.GetValue<decimal>();
        var completed = row["SettlementId"]?.GetValue<string>();
        if (amount > 0 && (final is null || amount > final) || completed is not null && (!applicable.Any(e => e.Id == completed) || amount != final))
            throw new InvalidOperationException("O total liquidado exige revisão dos movimentos existentes.");
        if (row["SettledAmount"]?.GetValue<decimal>() == amount && row["CreditProposals"] is not null) return json;
        row["SettledAmount"] = amount; row["CreditProposals"] ??= new JsonArray();
        row["Version"] = (row["Version"]?.GetValue<long>() ?? 1) + 1;
        return row.ToJsonString();
    }

    private static async Task<Plan> Read(MySqlConnection connection, MySqlTransaction? transaction, CancellationToken ct)
    {
        var entries = new List<CreditEntry>();
        await using (var command = new MySqlCommand("SELECT data FROM credit_entries ORDER BY id", connection, transaction))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) entries.Add(JsonSerializer.Deserialize<CreditEntry>(reader.GetString(0))!);
        var rows = new List<Row>(); var issues = new List<string>();
        foreach (var table in Tables)
        {
            await using var command = new MySqlCommand("SELECT id,data FROM " + table + " ORDER BY id" + (transaction is null ? "" : " FOR UPDATE"), connection, transaction);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var id = reader.GetGuid(0).ToString(); var before = reader.GetString(1);
                try { rows.Add(new(table, id, before, Upgrade(table, before, entries.ToArray()))); }
                catch (Exception error) when (error is InvalidOperationException or JsonException or FormatException)
                { issues.Add(table + ":" + id + ": " + error.Message); }
            }
        }
        return new(rows.ToArray(), issues.ToArray());
    }
    private static object Report(Plan plan) => new { records = plan.Rows.Length, toPrepare = plan.Rows.Count(r => r.Before != r.After),
        byTable = plan.Rows.GroupBy(r => r.Table).ToDictionary(g => g.Key, g => g.Count()),
        issues = plan.Issues, newReceipts = 0, newSettlements = 0, balanceChanges = 0 };

    public static async Task<object> RunAsync(DatabaseConnectionSettings settings, bool prepare, InstallationPaths paths,
        IDataProtectionProvider provider, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
        await using var gate = new MySqlCommand("SELECT GET_LOCK('pact0.2_db:client-writes',5)", connection);
        if (Convert.ToInt32(await gate.ExecuteScalarAsync(ct)) != 1) throw new InvalidOperationException("A aplicação está ocupada. Volta a tentar.");
        try
        {
            var plan = await Read(connection, null, ct);
            if (!prepare) return Report(plan);
            if (plan.Issues.Length > 0) throw new InvalidOperationException("A auditoria financeira exige revisão: " + string.Join("; ", plan.Issues));
            var changes = plan.Rows.Where(r => r.Before != r.After).ToArray();
            if (changes.Length > 0)
                await SchemaBackup.SaveVerifiedAsync(JsonSerializer.SerializeToUtf8Bytes(changes), "financial-summaries", paths, provider, ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            foreach (var row in changes)
            {
                await using var update = new MySqlCommand("UPDATE " + row.Table + " SET data=@after WHERE id=@id AND CAST(data AS CHAR)=@before", connection, transaction);
                update.Parameters.AddWithValue("@after", row.After); update.Parameters.AddWithValue("@id", row.Id); update.Parameters.AddWithValue("@before", row.Before);
                if (await update.ExecuteNonQueryAsync(ct) != 1) throw new InvalidOperationException("O registo mudou durante a preparação.");
            }
            var after = await Read(connection, transaction, ct);
            if (after.Issues.Length > 0 || after.Rows.Any(r => r.Before != r.After)) throw new InvalidOperationException("A verificação final da preparação falhou.");
            await transaction.CommitAsync(ct);
            return new { status = "prepared", recordsUpdated = changes.Length, audit = Report(after), ledgerUnchanged = true, accountsUnchanged = true };
        }
        finally { await using var release = new MySqlCommand("SELECT RELEASE_LOCK('pact0.2_db:client-writes')", connection); await release.ExecuteScalarAsync(CancellationToken.None); }
    }
}
