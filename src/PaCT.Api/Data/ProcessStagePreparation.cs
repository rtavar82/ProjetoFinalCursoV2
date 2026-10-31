using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

public static class ProcessStagePreparation
{
    internal static readonly string[] Tables = ["consultations", "guest_consultation_requests", "group_events", "event_participations"];
    internal sealed record Row(string Table, string Id, string Before, string After, string Stage);
    private sealed record Plan(Row[] Rows, string[] Issues);
    private static DateTimeOffset? Date(JsonNode row, string name) => row[name] is null ? null : row[name]!.GetValue<DateTimeOffset>();
    private static string? Text(JsonNode row, string name) => row[name]?.GetValue<string>();

    // Used only by the explicit upgrade, never as a fallback during ordinary application reads.
    internal static string Upgrade(string table, string json, IReadOnlyDictionary<string, JsonNode> events, DateTimeOffset now)
    {
        var row = JsonNode.Parse(json)!.AsObject();
        if (row.ContainsKey("Stage")) return json;
        var state = Text(row, "State") ?? throw new InvalidOperationException("Missing substate.");
        var start = table == "group_events" ? Date(row["Definition"]!, "StartsAt")!.Value
            : table == "event_participations" ? Date(events[Text(row, "EventId")!]["Definition"]!, "StartsAt")!.Value : Date(row, "StartsAt")!.Value;
        var approved = table == "event_participations" ? Date(row, "ConfirmedAt") : Date(row, "ApprovedAt");
        var closed = Date(row, "ClosedAt"); var cancelled = Date(row, "CancelledAt");
        var history = row["History"] as JsonArray;
        if (cancelled is null && state == "Cancelled")
        {
            cancelled = history?.Where(h => Text(h!, "Action")?.Contains("Cancel", StringComparison.OrdinalIgnoreCase) == true)
                .Select(h => Date(h!, "At")).LastOrDefault();
            if (cancelled is null && table == "event_participations")
                cancelled = (events[Text(row, "EventId")!]["History"] as JsonArray)?.Where(h => Text(h!, "Action") == "Cancel").Select(h => Date(h!, "At")).LastOrDefault();
        }
        var stage = table switch
        {
            "guest_consultation_requests" => ProcessStage.Request,
            _ when state is "Requested" or "Rejected" or "Expired" or "Waiting" => ProcessStage.Request,
            "event_participations" when state == "Cancelled" && approved is null => ProcessStage.Request,
            _ when state is "Performed" or "NoShow" or "AwaitingClosure" || Text(row, "Attendance") is "Performed" or "NoShow" => ProcessStage.Consultation,
            _ when state is "Cancelled" or "CancelledClient" or "CancelledManager" => closed is not null || cancelled >= start
                ? ProcessStage.Consultation : cancelled is not null ? ProcessStage.Booking : throw new InvalidOperationException("Cancellation time needs review."),
            _ when state is "Confirmed" or "Scheduled" => now >= start ? ProcessStage.Consultation : ProcessStage.Booking,
            _ => throw new InvalidOperationException("Unknown legacy substate.")
        };
        row["Stage"] = stage.ToString();
        if (table != "guest_consultation_requests")
        {
            var changes = new List<ProcessStageChange>();
            if (table is "consultations" or "event_participations" && approved is { } at)
                changes.Add(new(ProcessStage.Request, ProcessStage.Booking, at, Text(row, "ApprovedBy")));
            if (stage == ProcessStage.Consultation) changes.Add(new(ProcessStage.Booking, stage, start, null));
            row["StageHistory"] = JsonSerializer.SerializeToNode(changes);
        }
        row["Version"] = (row["Version"]?.GetValue<long>() ?? 1) + 1;
        return row.ToJsonString();
    }

    private static async Task<Plan> ReadPlan(MySqlConnection connection, MySqlTransaction? transaction, DateTimeOffset now, CancellationToken ct)
    {
        var raw = new List<(string Table, string Id, string Json)>();
        foreach (var table in Tables)
        {
            await using var command = new MySqlCommand("SELECT id,data FROM " + table + " ORDER BY id" + (transaction is null ? "" : " FOR UPDATE"), connection, transaction);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) raw.Add((table, reader.GetGuid(0).ToString(), reader.GetString(1)));
        }
        var events = raw.Where(r => r.Table == "group_events").ToDictionary(r => r.Id, r => JsonNode.Parse(r.Json)!);
        var rows = new List<Row>(); var issues = new List<string>();
        foreach (var row in raw)
        {
            try
            {
                var upgraded = Upgrade(row.Table, row.Json, events, now); var stage = Text(JsonNode.Parse(upgraded)!, "Stage")!;
                object model = row.Table switch {
                    "consultations" => JsonSerializer.Deserialize<Consultation>(upgraded)!,
                    "guest_consultation_requests" => JsonSerializer.Deserialize<GuestConsultationRequest>(upgraded)!,
                    "group_events" => JsonSerializer.Deserialize<GroupEvent>(upgraded)!,
                    _ => JsonSerializer.Deserialize<EventParticipation>(upgraded)! };
                ProcessLifecycle.Validate(model);
                rows.Add(new(row.Table, row.Id, row.Json, upgraded, stage));
            }
            catch (Exception e) when (e is InvalidOperationException or KeyNotFoundException or JsonException or FormatException)
            { issues.Add(row.Table + ":" + row.Id + ": " + e.Message.Split('\n')[0]); }
        }
        return new(rows.ToArray(), issues.ToArray());
    }
    private static object Report(Plan plan) => new { rows = plan.Rows.Length, rowsToPrepare = plan.Rows.Count(r => r.Before != r.After),
        byTable = plan.Rows.GroupBy(r => r.Table).Select(g => new { table = g.Key, rows = g.Count(), stages = g.GroupBy(r => r.Stage).ToDictionary(s => s.Key, s => s.Count()),
            substates = g.GroupBy(r => Text(JsonNode.Parse(r.Before)!, "State")!).ToDictionary(s => s.Key, s => s.Count()) }),
        issues = plan.Issues, businessWrites = 0 };

    public static async Task<object> AuditAsync(DatabaseConnectionSettings settings, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
        return Report(await ReadPlan(connection, null, DateTimeOffset.UtcNow, ct));
    }

    internal static string Definition(string table) => $"""
        process_stage VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(data,'$.Stage'))) STORED,
        CONSTRAINT CK_{table}_stage CHECK (JSON_CONTAINS_PATH(data,'one','$.Stage')=1 AND JSON_TYPE(JSON_EXTRACT(data,'$.Stage'))='STRING' AND process_stage IN ('Request','Booking','Consultation')),
        INDEX IX_process_stage (process_stage)
        """;
    internal static string WithStructure(string table, string sql) => Tables.Contains(table)
        ? sql.Replace(") ENGINE=InnoDB", ",\n" + Definition(table) + "\n) ENGINE=InnoDB", StringComparison.Ordinal) : sql;

    public static async Task<object> PrepareAsync(DatabaseConnectionSettings settings, InstallationPaths paths, IDataProtectionProvider provider, CancellationToken ct)
    {
        await using var connection = InitialIdentitySchema.CreatePreparationConnection(settings); await connection.OpenAsync(ct);
        async Task<object?> Scalar(string sql) { await using var command = new MySqlCommand(sql, connection); return await command.ExecuteScalarAsync(ct); }
        if ((string?)await Scalar("SELECT DATABASE()") != DatabaseConnectionSettings.ExpectedDatabaseName) throw new InvalidOperationException("Unexpected database.");
        if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:installation',0)")) != 1) throw new InvalidOperationException("Installation busy.");
        var added = new List<string>(); var dataChanged = false; Plan? original = null;
        try
        {
            if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:client-writes',5)")) != 1) throw new InvalidOperationException("Application busy.");
            original = await ReadPlan(connection, null, DateTimeOffset.UtcNow, ct);
            if (original.Issues.Length > 0) throw new InvalidOperationException("Audit requires review: " + string.Join("; ", original.Issues));
            var protectedTables = new List<string>();
            await using (var command = new MySqlCommand("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY table_name", connection))
            await using (var reader = await command.ExecuteReaderAsync(ct))
                while (await reader.ReadAsync(ct)) if (!Tables.Contains(reader.GetString(0))) protectedTables.Add(reader.GetString(0));
            var protectedBefore = SHA256.HashData(await TherapistInvitationSchema.SnapshotAsync(connection, protectedTables.ToArray(), ct));
            await SchemaBackup.SaveVerifiedAsync(await TherapistInvitationSchema.SnapshotAsync(connection, Tables, ct), "process-states", paths, provider, ct);
            await using (var transaction = await connection.BeginTransactionAsync(ct))
            {
                var locked = await ReadPlan(connection, transaction, DateTimeOffset.UtcNow, ct);
                if (!original.Rows.Select(r => r.Before).SequenceEqual(locked.Rows.Select(r => r.Before))) throw new InvalidOperationException("Records changed after the audit.");
                foreach (var row in original.Rows.Where(r => r.Before != r.After))
                {
                    await using var command = new MySqlCommand("UPDATE " + row.Table + " SET data=@data WHERE id=@id", connection, transaction);
                    command.Parameters.AddWithValue("@data", row.After); command.Parameters.AddWithValue("@id", row.Id);
                    if (await command.ExecuteNonQueryAsync(ct) != 1) throw new InvalidOperationException("Record changed during preparation.");
                }
                await transaction.CommitAsync(ct); dataChanged = true;
            }
            foreach (var table in Tables)
            {
                if (Convert.ToInt32(await Scalar("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='" + table + "' AND column_name='process_stage'")) != 0) continue;
                await using var command = new MySqlCommand("ALTER TABLE " + table + " ADD " + Definition(table).Replace(",\n", ",\nADD ", StringComparison.Ordinal), connection);
                await command.ExecuteNonQueryAsync(ct); added.Add(table);
            }
            var protectedAfter = SHA256.HashData(await TherapistInvitationSchema.SnapshotAsync(connection, protectedTables.ToArray(), ct));
            if (!protectedBefore.SequenceEqual(protectedAfter))
                throw new InvalidOperationException("Unrelated records changed during preparation.");
            var after = await ReadPlan(connection, null, DateTimeOffset.UtcNow, ct);
            if (after.Issues.Length != 0 || after.Rows.Any(r => r.Before != r.After) || !original.Rows.Select(r => r.Id).SequenceEqual(after.Rows.Select(r => r.Id)))
                throw new InvalidOperationException("Post-preparation audit failed.");
            return new { status = "prepared", audit = Report(after), schemaTablesChanged = added.Count, originalRecordsUpdated = original.Rows.Count(r => r.Before != r.After),
                ledgerAndAccountsUnchanged = true, sentCommunications = 0 };
        }
        catch
        {
            foreach (var table in added.AsEnumerable().Reverse())
            { await using var undo = new MySqlCommand($"ALTER TABLE {table} DROP INDEX IX_process_stage, DROP CHECK CK_{table}_stage, DROP COLUMN process_stage", connection); await undo.ExecuteNonQueryAsync(CancellationToken.None); }
            if (dataChanged && original is not null)
            {
                await using var transaction = await connection.BeginTransactionAsync(CancellationToken.None);
                foreach (var row in original.Rows.Where(r => r.Before != r.After))
                { await using var undo = new MySqlCommand("UPDATE " + row.Table + " SET data=@data WHERE id=@id", connection, transaction); undo.Parameters.AddWithValue("@data", row.Before); undo.Parameters.AddWithValue("@id", row.Id); await undo.ExecuteNonQueryAsync(CancellationToken.None); }
                await transaction.CommitAsync(CancellationToken.None);
            }
            throw;
        }
        finally { await Scalar("SELECT RELEASE_LOCK('pact0.2_db:client-writes'),RELEASE_LOCK('pact0.2_db:installation')"); }
    }
}
