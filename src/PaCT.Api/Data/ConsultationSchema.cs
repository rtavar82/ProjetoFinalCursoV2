using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;
using System.Security.Cryptography;
using PaCT.Api.Consultations;

namespace PaCT.Api.Data;

public static class ConsultationSchema
{
    public static readonly string[] Tables = ["consultation_services", "availability_windows", "consultations", "credit_entries", "consultation_notices", "consultation_commands"];
    public static readonly string[] FinanceTables = ["balance_notices", "push_subscriptions"];
    public static readonly string[] AgendaTables = ["guest_consultation_requests", "session_packs", "pack_uses", "pack_notices", "group_events", "event_participations", "event_cash_entries", "event_notices", "consultation_messages", "consultation_message_reads"];
    internal static string CreateSql(string table) => table switch
    {
        "consultation_services" or "availability_windows" => $"CREATE TABLE `{table}` (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, data JSON NOT NULL) ENGINE=InnoDB",
        "consultations" => """
            CREATE TABLE consultations (
              id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
              person_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              data JSON NOT NULL,
              FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT,
              CONSTRAINT CK_consultation_person CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.PersonId'))=person_id)
            ) ENGINE=InnoDB
            """,
        "credit_entries" => """
            CREATE TABLE credit_entries (
              id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
              person_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              consultation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
              amount DECIMAL(14,2) NOT NULL,
              data JSON NOT NULL,
              FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT,
              FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE RESTRICT,
              CONSTRAINT CK_credit_amount CHECK (amount<>0 AND CAST(JSON_EXTRACT(data,'$.Amount') AS DECIMAL(14,2))=amount),
              CONSTRAINT CK_credit_person CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.PersonId'))=person_id)
            ) ENGINE=InnoDB
            """,
        "consultation_notices" => """
            CREATE TABLE consultation_notices (
              id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
              consultation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              data JSON NOT NULL,
              FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE RESTRICT
            ) ENGINE=InnoDB
            """,
        "balance_notices" => """
            CREATE TABLE balance_notices (
              id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
              person_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              data JSON NOT NULL,
              FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT,
              CONSTRAINT CK_balance_notice_person CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.PersonId'))=person_id)
            ) ENGINE=InnoDB
            """,
        "push_subscriptions" => """
            CREATE TABLE push_subscriptions (
              id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
              account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              payload LONGBLOB NOT NULL,
              updated_at DATETIME(6) NOT NULL,
              FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
            ) ENGINE=InnoDB
            """,
        "consultation_commands" => """
            CREATE TABLE consultation_commands (
              id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
              author_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              result JSON NOT NULL,
              created_at DATETIME(6) NOT NULL,
              FOREIGN KEY (author_id) REFERENCES accounts(id) ON DELETE RESTRICT
            ) ENGINE=InnoDB
            """,
        "guest_consultation_requests" => """
            CREATE TABLE guest_consultation_requests (
              id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
              operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
              service_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              person_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
              consultation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
              data JSON NOT NULL,
              FOREIGN KEY (service_id) REFERENCES consultation_services(id) ON DELETE RESTRICT,
              FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT,
              FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE RESTRICT,
              CONSTRAINT CK_guest_operation CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.OperationId'))=operation_id),
              CONSTRAINT CK_guest_service CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.Service.Id'))=service_id),
              CONSTRAINT CK_guest_state CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.State')) IN ('Requested','InTreatment','Linked','Rejected','Expired'))
            ) ENGINE=InnoDB
            """,
        "session_packs" => """
            CREATE TABLE session_packs (
              id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
              person_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              data JSON NOT NULL,
              FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT,
              CONSTRAINT CK_pack_person CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.PersonId'))=person_id),
              CONSTRAINT CK_pack_sessions CHECK (CAST(JSON_EXTRACT(data,'$.Sessions') AS UNSIGNED) BETWEEN 1 AND 1000)
            ) ENGINE=InnoDB
            """,
        "group_events" => """
            CREATE TABLE group_events (
              id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
              service_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              data JSON NOT NULL,
              FOREIGN KEY (service_id) REFERENCES consultation_services(id) ON DELETE RESTRICT,
              CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.Service.Id'))=service_id)
            ) ENGINE=InnoDB
            """,
        "event_participations" => """
            CREATE TABLE event_participations (
              id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
              event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              person_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
              guest_operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE,
              data JSON NOT NULL,
              FOREIGN KEY (event_id) REFERENCES group_events(id) ON DELETE RESTRICT,
              FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT,
              CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.EventId'))=event_id),
              CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.State')) IN ('Requested','Confirmed','Waiting','Cancelled'))
            ) ENGINE=InnoDB
            """,
        "event_cash_entries" => """
            CREATE TABLE event_cash_entries (
              id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
              event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              participation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
              amount DECIMAL(14,2) NOT NULL,
              data JSON NOT NULL,
              FOREIGN KEY (event_id) REFERENCES group_events(id) ON DELETE RESTRICT,
              FOREIGN KEY (participation_id) REFERENCES event_participations(id) ON DELETE RESTRICT,
              CHECK (amount>0 AND CAST(JSON_EXTRACT(data,'$.Amount') AS DECIMAL(14,2))=amount)
            ) ENGINE=InnoDB
            """,
        "event_notices" => """
            CREATE TABLE event_notices (
              id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
              event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              participation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              data JSON NOT NULL,
              FOREIGN KEY (event_id) REFERENCES group_events(id) ON DELETE RESTRICT,
              FOREIGN KEY (participation_id) REFERENCES event_participations(id) ON DELETE RESTRICT
            ) ENGINE=InnoDB
            """,
        "consultation_messages" => """
            CREATE TABLE consultation_messages (
              id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
              consultation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              author_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              sequence BIGINT NOT NULL,
              data JSON NOT NULL,
              UNIQUE KEY UX_consultation_message_sequence (consultation_id,sequence),
              FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE RESTRICT,
              FOREIGN KEY (author_id) REFERENCES accounts(id) ON DELETE RESTRICT,
              CHECK (sequence>0 AND CAST(JSON_EXTRACT(data,'$.Sequence') AS SIGNED)=sequence),
              CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.ConsultationId'))=consultation_id),
              CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.AuthorId'))=author_id)
            ) ENGINE=InnoDB
            """,
        "consultation_message_reads" => """
            CREATE TABLE consultation_message_reads (
              id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
              message_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              data JSON NOT NULL,
              UNIQUE KEY UX_consultation_message_read (message_id,account_id),
              FOREIGN KEY (message_id) REFERENCES consultation_messages(id) ON DELETE RESTRICT,
              FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
              CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.MessageId'))=message_id),
              CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.AccountId'))=account_id)
            ) ENGINE=InnoDB
            """,
        "pack_uses" or "pack_notices" => $"""
            CREATE TABLE `{table}` (
              id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
              pack_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              person_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              data JSON NOT NULL,
              FOREIGN KEY (pack_id) REFERENCES session_packs(id) ON DELETE RESTRICT,
              FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT,
              CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.PackId'))=pack_id),
              CHECK (JSON_UNQUOTE(JSON_EXTRACT(data,'$.PersonId'))=person_id)
            ) ENGINE=InnoDB
            """,
        _ => throw new InvalidOperationException("Unknown schema table.")
    };
    public static async Task PrepareAsync(DatabaseConnectionSettings settings, InstallationPaths paths, IDataProtectionProvider provider, CancellationToken ct)
    {
        await using var connection = InitialIdentitySchema.CreatePreparationConnection(settings); await connection.OpenAsync(ct);
        async Task<object?> Scalar(string sql) { await using var command = new MySqlCommand(sql, connection); return await command.ExecuteScalarAsync(ct); }
        if ((string?)await Scalar("SELECT DATABASE()") != DatabaseConnectionSettings.ExpectedDatabaseName) throw new InvalidOperationException("Unexpected database.");
        if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:installation',0)")) != 1) throw new InvalidOperationException("Installation busy.");
        try
        {
            if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:client-writes',5)")) != 1) throw new InvalidOperationException("Application busy.");
            var existing = new List<string>();
            await using (var command = new MySqlCommand("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME", connection))
            await using (var reader = await command.ExecuteReaderAsync(ct)) while (await reader.ReadAsync(ct)) existing.Add(reader.GetString(0));
            string[] baseline = ["accounts", "client_notes", "client_reviews", "people", "security_emails", "therapist_invitations"];
            if (existing.Contains("account_passkeys")) baseline = [..baseline, "account_passkeys"];
            if (existing.Contains("account_security_actions")) baseline = [..baseline, "account_security_actions"];
            if (existing.Contains("account_external_logins")) baseline = [..baseline, "account_external_logins"];
            if (Tables.All(existing.Contains))
            {
                if (!existing.Except(FinanceTables).Except(AgendaTables).Order().SequenceEqual(baseline.Concat(Tables).Order()) || existing.Intersect(FinanceTables).Count() is not (0 or 2)) throw new InvalidOperationException("Unexpected schema; no migration attempted.");
                var protectedBefore = await TherapistInvitationSchema.SnapshotAsync(connection, baseline, ct);
                var snapshotAll = await TherapistInvitationSchema.SnapshotAsync(connection, existing.ToArray(), ct);
                await SchemaBackup.SaveVerifiedAsync(snapshotAll, "consultations-agenda-guests", paths, provider, ct);
                foreach (var table in FinanceTables.Concat(AgendaTables).Except(existing)) { await using var create = new MySqlCommand(CreateSql(table), connection); await create.ExecuteNonQueryAsync(ct); }
                await using (var transaction = await connection.BeginTransactionAsync(ct))
                {
                    var data = await MySqlConsultationStore.Load(connection, transaction, ct);
                    var before = MySqlConsultationStore.Snapshot(data);
                    ConsultationRules.Advance(data, DateTimeOffset.UtcNow);
                    await MySqlConsultationStore.Save(connection, transaction, data, before, ct);
                    await transaction.CommitAsync(ct);
                }
                var protectedAfter = await TherapistInvitationSchema.SnapshotAsync(connection, baseline, ct);
                if (!SHA256.HashData(protectedBefore).SequenceEqual(SHA256.HashData(protectedAfter))) throw new InvalidOperationException("Existing identity data changed during preparation.");
                return;
            }
            if (!existing.Order().SequenceEqual(baseline.Order())) throw new InvalidOperationException("Unexpected or partial schema; no replacement attempted.");
            var snapshot = await TherapistInvitationSchema.SnapshotAsync(connection, baseline, ct);
            await SchemaBackup.SaveVerifiedAsync(snapshot, "consultations-v21", paths, provider, ct);
            foreach (var table in Tables.Concat(FinanceTables).Concat(AgendaTables)) { await using var create = new MySqlCommand(CreateSql(table), connection); await create.ExecuteNonQueryAsync(ct); }
            var after = await TherapistInvitationSchema.SnapshotAsync(connection, baseline, ct);
            if (!SHA256.HashData(snapshot).SequenceEqual(SHA256.HashData(after))) throw new InvalidOperationException("Existing data changed during preparation.");
        }
        finally
        {
            await using var release = new MySqlCommand("SELECT RELEASE_LOCK('pact0.2_db:client-writes'), RELEASE_LOCK('pact0.2_db:installation')", connection);
            await release.ExecuteNonQueryAsync(CancellationToken.None);
        }
    }
}
