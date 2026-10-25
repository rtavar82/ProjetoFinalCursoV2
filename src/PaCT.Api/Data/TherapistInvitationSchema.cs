using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

public static class TherapistInvitationSchema
{
    public const string Sql = """
        CREATE TABLE `therapist_invitations` (
            `id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `sequence` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            `created_by_account_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `email_ciphertext` VARBINARY(1280) NOT NULL,
            `email_hash` BINARY(32) NOT NULL,
            `security_stamp` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `email_job_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `created_at` DATETIME(6) NOT NULL,
            `expires_at` DATETIME(6) NOT NULL,
            `cancelled_at` DATETIME(6) NULL,
            `accepted_at` DATETIME(6) NULL,
            `accepted_by_account_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
            `open_slot` TINYINT GENERATED ALWAYS AS (IF(`cancelled_at` IS NULL AND `accepted_at` IS NULL, 1, NULL)) STORED,
            PRIMARY KEY (`id`),
            UNIQUE KEY `UQ_therapist_invitations_sequence` (`sequence`),
            UNIQUE KEY `UQ_therapist_invitations_open` (`open_slot`),
            UNIQUE KEY `UQ_therapist_invitations_email_job` (`email_job_id`),
            CONSTRAINT `FK_therapist_invitations_issuer` FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT `FK_therapist_invitations_email` FOREIGN KEY (`email_job_id`) REFERENCES `security_emails` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT `FK_therapist_invitations_account` FOREIGN KEY (`accepted_by_account_id`) REFERENCES `accounts` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT `CK_therapist_invitations_fields` CHECK (OCTET_LENGTH(`email_ciphertext`) > 0 AND CHAR_LENGTH(TRIM(`security_stamp`)) > 0),
            CONSTRAINT `CK_therapist_invitations_acceptance` CHECK ((`accepted_at` IS NULL) = (`accepted_by_account_id` IS NULL) AND (`cancelled_at` IS NULL OR `accepted_at` IS NULL)),
            CONSTRAINT `CK_therapist_invitations_dates` CHECK (`expires_at` > `created_at` AND (`cancelled_at` IS NULL OR `cancelled_at` >= `created_at`) AND (`accepted_at` IS NULL OR (`accepted_at` >= `created_at` AND `accepted_at` < `expires_at`)))
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
        """;

    public static async Task<PreparedSchemaTable> PrepareAsync(DatabaseConnectionSettings settings, InstallationPaths paths, IDataProtectionProvider provider, CancellationToken ct)
    {
        await using var connection = InitialIdentitySchema.CreatePreparationConnection(settings);
        await connection.OpenAsync(ct);
        await using var database = new MySqlCommand("SELECT DATABASE()", connection);
        if ((string?)await database.ExecuteScalarAsync(ct) != DatabaseConnectionSettings.ExpectedDatabaseName)
            throw new InvalidOperationException("The approved database was not confirmed.");
        await using var gate = new MySqlCommand("SELECT GET_LOCK('pact0.2_db:installation',0)", connection);
        if (Convert.ToInt32(await gate.ExecuteScalarAsync(ct)) != 1) throw new InvalidOperationException("Another preparation is running.");
        try
        {
            var names = new List<string>();
            await using (var command = new MySqlCommand("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME", connection))
            await using (var reader = await command.ExecuteReaderAsync(ct)) while (await reader.ReadAsync(ct)) names.Add(reader.GetString(0));
            var baseline = new[] { "accounts", "people", "security_emails" };
            if (names.SequenceEqual(new[] { "accounts", "client_notes", "client_reviews", "people", "security_emails", "therapist_invitations" }, StringComparer.Ordinal))
            { await ClientSchema.VerifyAsync(connection, ct); return await VerifyAsync(connection, ct); }
            if (names.SequenceEqual(baseline.Append("therapist_invitations"), StringComparer.Ordinal)) return await VerifyAsync(connection, ct);
            if (!names.SequenceEqual(baseline, StringComparer.Ordinal)) throw new InvalidOperationException("Unexpected schema; no automatic replacement is allowed.");
            var before = await SnapshotAsync(connection, baseline, ct);
            await SchemaBackup.SaveVerifiedAsync(before, "therapist-invitations", paths, provider, ct);
            await using (var create = new MySqlCommand(Sql, connection)) await create.ExecuteNonQueryAsync(ct);
            var result = await VerifyAsync(connection, ct);
            var after = await SnapshotAsync(connection, baseline, ct);
            if (!SHA256.HashData(before).SequenceEqual(SHA256.HashData(after)))
                throw new InvalidOperationException("Existing data changed during preparation. Preserve the backup and investigate; no rollback deletion was attempted.");
            return result;
        }
        finally
        {
            await using var release = new MySqlCommand("SELECT RELEASE_LOCK('pact0.2_db:installation')", connection);
            await release.ExecuteScalarAsync(CancellationToken.None);
        }
    }

    internal static async Task<PreparedSchemaTable> VerifyAsync(MySqlConnection connection, CancellationToken ct)
    {
        var expected = Sql.Split('\n').Select(line => line.TrimStart()).Where(line => line.StartsWith('`')).Select(line => line.Split('`')[1]);
        var actual = new List<string>();
        await using (var command = new MySqlCommand("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='therapist_invitations' ORDER BY ORDINAL_POSITION", connection))
        await using (var reader = await command.ExecuteReaderAsync(ct)) while (await reader.ReadAsync(ct)) actual.Add(reader.GetString(0));
        if (!expected.SequenceEqual(actual, StringComparer.Ordinal)) throw new InvalidOperationException("The invitation schema requires review; it was not replaced.");
        await using var count = new MySqlCommand("SELECT COUNT(*) FROM therapist_invitations", connection);
        return new("therapist_invitations", Convert.ToInt64(await count.ExecuteScalarAsync(ct)));
    }

    internal static async Task<byte[]> SnapshotAsync(MySqlConnection connection, IEnumerable<string> tables, CancellationToken ct, MySqlTransaction? transaction = null)
    {
        var snapshot = new Dictionary<string, object>();
        foreach (var table in tables)
        {
            string definition;
            await using (var command = new MySqlCommand("SHOW CREATE TABLE `" + table + "`", connection, transaction))
            await using (var reader = await command.ExecuteReaderAsync(ct)) { await reader.ReadAsync(ct); definition = reader.GetString(1); }
            var rows = new List<Dictionary<string, object?>>();
            await using (var command = new MySqlCommand("SELECT * FROM `" + table + "` ORDER BY id", connection, transaction))
            await using (var reader = await command.ExecuteReaderAsync(ct))
                while (await reader.ReadAsync(ct))
                {
                    var row = new Dictionary<string, object?>();
                    for (var column = 0; column < reader.FieldCount; column++) row[reader.GetName(column)] = reader.IsDBNull(column) ? null : reader.GetValue(column);
                    rows.Add(row);
                }
            snapshot[table] = new { definition, rows };
        }
        return JsonSerializer.SerializeToUtf8Bytes(snapshot);
    }
}
