using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

public static class ClientSchema
{
    public const string NotesSql = """
        CREATE TABLE client_notes (
          id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
          person_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          content_ciphertext MEDIUMBLOB NOT NULL,
          created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL,
          version BIGINT UNSIGNED NOT NULL DEFAULT 1,
          KEY IX_client_notes_person (person_id,updated_at),
          FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT,
          FOREIGN KEY (created_by) REFERENCES accounts(id) ON DELETE RESTRICT,
          FOREIGN KEY (updated_by) REFERENCES accounts(id) ON DELETE RESTRICT,
          CONSTRAINT CK_client_notes CHECK (OCTET_LENGTH(content_ciphertext)>0 AND version>0 AND updated_at>=created_at)
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
        """;
    public const string ReviewsSql = """
        CREATE TABLE client_reviews (
          id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
          kind VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          person_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
          proposal_ciphertext MEDIUMBLOB NOT NULL, candidate_ids JSON NOT NULL,
          status VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          author_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
          created_at DATETIME(6) NOT NULL, source_version BIGINT UNSIGNED NOT NULL,
          version BIGINT UNSIGNED NOT NULL DEFAULT 1,
          decided_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
          decided_at DATETIME(6) NULL,
          associated_person_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
          selected_fields JSON NULL,
          KEY IX_client_reviews_status (status,created_at),
          KEY IX_client_reviews_person (person_id,created_at),
          FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT,
          FOREIGN KEY (author_id) REFERENCES accounts(id) ON DELETE RESTRICT,
          FOREIGN KEY (decided_by) REFERENCES accounts(id) ON DELETE RESTRICT,
          FOREIGN KEY (associated_person_id) REFERENCES people(id) ON DELETE RESTRICT,
          CONSTRAINT CK_client_reviews_kind CHECK (kind IN ('Registration','Manual','Edit')),
          CONSTRAINT CK_client_reviews_status CHECK (status IN ('Open','Accepted','Rejected')),
          CONSTRAINT CK_client_reviews_fields CHECK (version>0 AND OCTET_LENGTH(proposal_ciphertext)>0),
          CONSTRAINT CK_client_reviews_decision CHECK ((status='Open' AND decided_at IS NULL AND decided_by IS NULL)
            OR (status<>'Open' AND decided_at IS NOT NULL AND decided_by IS NOT NULL AND decided_at>=created_at))
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
        """;
    private static readonly string[] Baseline = ["accounts", "people", "security_emails", "therapist_invitations"];

    public static async Task PrepareAsync(DatabaseConnectionSettings settings, InstallationPaths paths, IDataProtectionProvider provider, CancellationToken ct)
    {
        await using var connection = InitialIdentitySchema.CreatePreparationConnection(settings);
        await connection.OpenAsync(ct);
        if ((string?)await Scalar(connection, "SELECT DATABASE()", ct) != DatabaseConnectionSettings.ExpectedDatabaseName) throw new InvalidOperationException("Unexpected database.");
        if (Convert.ToInt32(await Scalar(connection, "SELECT GET_LOCK('pact0.2_db:installation',0)", ct)) != 1) throw new InvalidOperationException("Another preparation is running.");
        try
        {
            var tables = new List<string>();
            await using (var command = new MySqlCommand("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME", connection))
            await using (var reader = await command.ExecuteReaderAsync(ct)) while (await reader.ReadAsync(ct)) tables.Add(reader.GetString(0));
            if (tables.SequenceEqual(Baseline.Concat(["client_notes", "client_reviews"]).Order(StringComparer.Ordinal))) { await VerifyAsync(connection, ct); return; }
            if (!tables.SequenceEqual(Baseline)) throw new InvalidOperationException("Unexpected or partially changed schema. Preserve backups and review it; no replacement was attempted.");
            var snapshot = await TherapistInvitationSchema.SnapshotAsync(connection, Baseline, ct);
            var before = await OriginalRows(connection, ct);
            await SchemaBackup.SaveVerifiedAsync(snapshot, "clients", paths, provider, ct);
            await Execute(connection, """
                ALTER TABLE people MODIFY first_name_ciphertext VARBINARY(512) NULL,
                MODIFY last_name_ciphertext VARBINARY(512) NULL, MODIFY locality VARCHAR(150) NULL,
                ADD COLUMN postal_code_ciphertext VARBINARY(512) NULL,
                DROP CHECK CK_people_relationship,
                ADD CONSTRAINT CK_people_relationship CHECK (relationship_status IS NULL OR relationship_status IN ('Married','Separated','Partnered','Unpartnered','Widowed'))
                """, ct);
            await Execute(connection, """
                ALTER TABLE accounts MODIFY password_hash VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NULL,
                DROP CHECK CK_accounts_fields,
                ADD CONSTRAINT CK_accounts_fields CHECK (CHAR_LENGTH(TRIM(security_stamp))>0 AND version>0
                  AND (password_hash IS NULL OR CHAR_LENGTH(TRIM(password_hash))>0)
                  AND (role='Client' OR (password_hash IS NOT NULL AND CHAR_LENGTH(TRIM(display_name))>0)))
                """, ct);
            await Execute(connection, NotesSql, ct);
            await Execute(connection, ReviewsSql, ct);
            await VerifyAsync(connection, ct);
            var after = await OriginalRows(connection, ct);
            if (!SHA256.HashData(before).SequenceEqual(SHA256.HashData(after)))
                throw new InvalidOperationException("Existing rows changed. Preserve the protected backup; no destructive rollback was attempted.");
        }
        finally { await Scalar(connection, "SELECT RELEASE_LOCK('pact0.2_db:installation')", CancellationToken.None); }
    }
    internal static async Task VerifyAsync(MySqlConnection connection, CancellationToken ct)
    {
        var checks = new Dictionary<string, string[]> {
            ["client_notes"] = ["id","person_id","content_ciphertext","created_by","updated_by","created_at","updated_at","version"],
            ["client_reviews"] = ["id","kind","person_id","proposal_ciphertext","candidate_ids","status","author_id","created_at","source_version","version","decided_by","decided_at","associated_person_id","selected_fields"] };
        foreach (var check in checks)
        {
            await using var command = new MySqlCommand("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@table ORDER BY ORDINAL_POSITION", connection);
            command.Parameters.AddWithValue("@table", check.Key);
            var columns = new List<string>();
            await using (var reader = await command.ExecuteReaderAsync(ct)) while (await reader.ReadAsync(ct)) columns.Add(reader.GetString(0));
            if (!columns.SequenceEqual(check.Value, StringComparer.Ordinal)) throw new InvalidOperationException("The client schema was not confirmed.");
        }
        var nullable = Convert.ToInt32(await Scalar(connection, "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND IS_NULLABLE='YES' AND ((TABLE_NAME='people' AND COLUMN_NAME IN ('first_name_ciphertext','last_name_ciphertext','locality','postal_code_ciphertext')) OR (TABLE_NAME='accounts' AND COLUMN_NAME='password_hash'))", ct));
        if (nullable != 5) throw new InvalidOperationException("Email-only registration schema was not confirmed.");
    }
    private static async Task<byte[]> OriginalRows(MySqlConnection connection, CancellationToken ct)
    {
        var result = new Dictionary<string, object>();
        foreach (var table in Baseline)
        {
            var columns = new List<string>();
            await using (var command = new MySqlCommand("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@table AND COLUMN_NAME<>'postal_code_ciphertext' ORDER BY ORDINAL_POSITION", connection))
            {
                command.Parameters.AddWithValue("@table", table);
                await using var reader = await command.ExecuteReaderAsync(ct); while (await reader.ReadAsync(ct)) columns.Add(reader.GetString(0));
            }
            var rows = new List<object?[]>();
            await using (var command = new MySqlCommand("SELECT " + string.Join(',', columns.Select(c => "`" + c + "`")) + " FROM `" + table + "` ORDER BY id", connection))
            await using (var reader = await command.ExecuteReaderAsync(ct))
                while (await reader.ReadAsync(ct)) { var row = new object?[reader.FieldCount]; for (var i = 0; i < row.Length; i++) row[i] = reader.IsDBNull(i) ? null : reader.GetValue(i); rows.Add(row); }
            result[table] = rows;
        }
        return JsonSerializer.SerializeToUtf8Bytes(result);
    }
    private static async Task<object?> Scalar(MySqlConnection c, string sql, CancellationToken ct) { await using var command = new MySqlCommand(sql, c); return await command.ExecuteScalarAsync(ct); }
    private static async Task Execute(MySqlConnection c, string sql, CancellationToken ct) { await using var command = new MySqlCommand(sql, c); await command.ExecuteNonQueryAsync(ct); }
}
