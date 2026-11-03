using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

// Explicit upgrade. No hosted service calls this class and no ledger entries are rewritten.
public static class EventRulesPreparation
{
    internal static string Upgrade(string table, string json, DateTimeOffset now)
    {
        var row = JsonNode.Parse(json)!.AsObject();
        var changed = row.Remove("Stage");
        if (table == "event_participations") changed = row.Remove("ProtectedSeat") || changed; // historical StageHistory remains available as audit evidence.
        if (table == "group_events" && row["State"]?.GetValue<string>() == "Scheduled")
        {
            row["State"] = row["Definition"]!["StartsAt"]!.GetValue<DateTimeOffset>() <= now ? "AwaitingClosure" : "Waiting";
            changed = true;
        }
        if (table == "event_participations" && row["State"]?.GetValue<string>() == "Cancelled" && row["CancellationBy"]?.GetValue<string>() == "Rejected")
        { row["State"] = "Rejected"; changed = true; }
        if (!changed) return json;
        row["Version"] = (row["Version"]?.GetValue<long>() ?? 1) + 1;
        return row.ToJsonString();
    }

    public static async Task<object> RunAsync(DatabaseConnectionSettings settings, bool prepare, InstallationPaths paths,
        IDataProtectionProvider protection, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
        async Task<object?> Scalar(string sql)
        { await using var c = new MySqlCommand(sql, connection); return await c.ExecuteScalarAsync(ct); }
        async Task Execute(string sql)
        { await using var c = new MySqlCommand(sql, connection); await c.ExecuteNonQueryAsync(ct); }
        if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:client-writes',5)")) != 1)
            throw new InvalidOperationException("A aplicação está ocupada. Volta a tentar.");
        try
        {
            var rows = new List<(string Table, string Id, string Before, string After)>();
            var backup = new Dictionary<string, object>();
            foreach (var table in new[] { "group_events", "event_participations", "event_notices", "consultation_messages", "consultation_message_reads" })
            {
                var entries = new List<object>();
                await using (var command = new MySqlCommand("SELECT id,data FROM " + table + " ORDER BY id", connection))
                await using (var reader = await command.ExecuteReaderAsync(ct))
                    while (await reader.ReadAsync(ct))
                    {
                        var id = reader.GetGuid(0).ToString(); var json = reader.GetString(1);
                        entries.Add(new { id, data = json });
                        if (table is "group_events" or "event_participations") rows.Add((table, id, json, Upgrade(table, json, DateTimeOffset.UtcNow)));
                    }
                backup[table] = entries;
                await using var schema = new MySqlCommand("SHOW CREATE TABLE " + table, connection);
                await using var schemaReader = await schema.ExecuteReaderAsync(ct); await schemaReader.ReadAsync(ct);
                backup[table + ":schema"] = schemaReader.GetString(1);
            }
            var changes = rows.Where(r => r.Before != r.After).ToArray();
            var hasTarget = Convert.ToInt32(await Scalar("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='consultation_messages' AND column_name='participation_id'")) == 1;
            var eventNoticeNullable = Convert.ToInt32(await Scalar("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='event_notices' AND column_name='participation_id' AND is_nullable='YES'")) == 1;
            var obsoleteStages = Convert.ToInt32(await Scalar("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name IN ('group_events','event_participations') AND column_name='process_stage'"));
            var eventStateReady = Convert.ToInt32(await Scalar("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() AND table_name='group_events' AND constraint_name='CK_group_event_state'")) == 1;
            if (!prepare) return new { eventStateConstraintReady = eventStateReady, obsoleteStageColumns = obsoleteStages, status = "audited", recordsToUpgrade = changes.Length, messageTargetColumnReady = hasTarget, eventNoticeNullable,
                ledgerChanges = 0, missingMinimum = rows.Count(r => r.Table == "group_events" && JsonNode.Parse(r.After)?["Definition"]?["MinimumParticipants"] is null) };
            if (changes.Length > 0 || !hasTarget || !eventNoticeNullable || obsoleteStages > 0 || !eventStateReady)
                await SchemaBackup.SaveVerifiedAsync(JsonSerializer.SerializeToUtf8Bytes(backup), "event-rules-20261103", paths, protection, ct);
            // MySQL DDL commits implicitly; each step is checked independently and is repeatable.
            if (!eventNoticeNullable) await Execute("ALTER TABLE event_notices MODIFY participation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL");
            if (!hasTarget) await Execute("ALTER TABLE consultation_messages ADD COLUMN participation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL, MODIFY consultation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL, ADD CONSTRAINT FK_message_participation FOREIGN KEY(participation_id) REFERENCES event_participations(id) ON DELETE RESTRICT, ADD UNIQUE KEY UX_participation_message_sequence(participation_id,sequence), ADD CONSTRAINT CK_message_target CHECK ((consultation_id IS NULL) <> (participation_id IS NULL))");
            foreach (var table in new[] { "group_events", "event_participations" })
                if (Convert.ToInt32(await Scalar("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='" + table + "' AND column_name='process_stage'")) == 1)
                    await Execute("ALTER TABLE " + table + " DROP CHECK CK_" + table + "_stage, DROP INDEX IX_process_stage, DROP COLUMN process_stage");
            var constraints = new List<string>();
            await using (var query = new MySqlCommand("SELECT tc.constraint_name FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc ON cc.constraint_schema=tc.constraint_schema AND cc.constraint_name=tc.constraint_name WHERE tc.table_schema=DATABASE() AND tc.table_name='event_participations' AND cc.check_clause LIKE '%State%'", connection))
            await using (var reader = await query.ExecuteReaderAsync(ct)) while (await reader.ReadAsync(ct)) constraints.Add(reader.GetString(0));
            foreach (var name in constraints)
            {
                if (!System.Text.RegularExpressions.Regex.IsMatch(name, "^[A-Za-z0-9_]+$")) throw new InvalidOperationException("Restrição SQL inesperada.");
                await Execute("ALTER TABLE event_participations DROP CHECK `" + name + "`");
            }
            await Execute("ALTER TABLE event_participations ADD CONSTRAINT CK_event_participation_state CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.State')) IN ('Requested','Confirmed','Waiting','Cancelled','Rejected','Expired'))");
            await using var transaction = await connection.BeginTransactionAsync(ct);
            foreach (var row in changes)
            {
                await using var update = new MySqlCommand("UPDATE " + row.Table + " SET data=@after WHERE id=@id AND CAST(data AS CHAR)=@before", connection, transaction);
                update.Parameters.AddWithValue("@id", row.Id); update.Parameters.AddWithValue("@before", row.Before); update.Parameters.AddWithValue("@after", row.After);
                if (await update.ExecuteNonQueryAsync(ct) != 1) throw new InvalidOperationException("O evento mudou durante a preparação.");
            }
            await transaction.CommitAsync(ct);
            if (!eventStateReady) await Execute("ALTER TABLE group_events ADD CONSTRAINT CK_group_event_state CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.State')) IN ('Waiting','AwaitingClosure','Performed','Cancelled'))");
            return new { status = "prepared", recordsUpdated = changes.Length, obsoleteStageColumnsRemoved = obsoleteStages, ledgerChanges = 0, accountsChanged = 0, messagesPreserved = true, missingMinimumRequiresManager = true };
        }
        finally { await Scalar("SELECT RELEASE_LOCK('pact0.2_db:client-writes')"); }
    }
}
