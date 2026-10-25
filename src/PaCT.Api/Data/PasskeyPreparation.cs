using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

public static class PasskeyPreparation
{
    public const string Sql = """
        CREATE TABLE account_passkeys (
          id VARBINARY(1024) NOT NULL PRIMARY KEY,
          account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          public_key VARBINARY(2048) NOT NULL,
          sign_count INT UNSIGNED NOT NULL DEFAULT 0,
          transports JSON NOT NULL, backup_eligible BOOLEAN NOT NULL, backed_up BOOLEAN NOT NULL,
          name VARCHAR(100) NOT NULL, created_at DATETIME(6) NOT NULL, last_used_at DATETIME(6) NULL,
          KEY IX_account_passkeys_account (account_id),
          CONSTRAINT FK_account_passkeys_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
          CONSTRAINT CK_account_passkeys_fields CHECK (OCTET_LENGTH(id)>0 AND OCTET_LENGTH(public_key)>0 AND CHAR_LENGTH(TRIM(name))>0 AND (backed_up=0 OR backup_eligible=1))
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
        """;
    public static async Task PrepareAsync(DatabaseConnectionSettings settings, InstallationPaths paths, IDataProtectionProvider provider, CancellationToken ct)
    {
        await using var c = InitialIdentitySchema.CreatePreparationConnection(settings); await c.OpenAsync(ct);
        async Task<object?> Scalar(string sql) { await using var cmd = new MySqlCommand(sql, c); return await cmd.ExecuteScalarAsync(ct); }
        async Task Execute(string sql) { await using var cmd = new MySqlCommand(sql, c); await cmd.ExecuteNonQueryAsync(ct); }
        if ((string?)await Scalar("SELECT DATABASE()") != DatabaseConnectionSettings.ExpectedDatabaseName) throw new InvalidOperationException("Unexpected database.");
        if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:installation',0)")) != 1) throw new InvalidOperationException("Installation busy.");
        try
        {
            if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:client-writes',5)")) != 1) throw new InvalidOperationException("Application busy.");
            var tables = new List<string>();
            await using (var cmd = new MySqlCommand("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME", c))
            await using (var r = await cmd.ExecuteReaderAsync(ct)) while (await r.ReadAsync(ct)) tables.Add(r.GetString(0));
            if (!tables.Contains("accounts")) throw new InvalidOperationException("Prepare the installation first.");
            var hasColumn = Convert.ToInt32(await Scalar("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='accounts' AND COLUMN_NAME='passkey_enabled_at'")) == 1;
            if (hasColumn && tables.Contains("account_passkeys")) return;
            var columns = new List<string>();
            await using (var cmd = new MySqlCommand("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='accounts' ORDER BY ORDINAL_POSITION", c))
            await using (var r = await cmd.ExecuteReaderAsync(ct)) while (await r.ReadAsync(ct)) columns.Add(r.GetString(0));
            var accountsBefore = await AccountRows(c, columns, ct);
            var otherBefore = await TherapistInvitationSchema.SnapshotAsync(c, tables.Where(t => t != "accounts"), ct);
            var snapshot = await TherapistInvitationSchema.SnapshotAsync(c, tables, ct);
            await SchemaBackup.SaveVerifiedAsync(snapshot, "passkeys-additive", paths, provider, ct);
            if (!hasColumn) await Execute("ALTER TABLE accounts ADD COLUMN passkey_enabled_at DATETIME(6) NULL AFTER version");
            if (!tables.Contains("account_passkeys")) await Execute(Sql);
            // This stage never resets authentication, revokes accounts or removes legacy columns.
            var accountsAfter = await AccountRows(c, columns, ct);
            var otherAfter = await TherapistInvitationSchema.SnapshotAsync(c, tables.Where(t => t != "accounts"), ct);
            if (!SHA256.HashData(accountsBefore).SequenceEqual(SHA256.HashData(accountsAfter)) || !SHA256.HashData(otherBefore).SequenceEqual(SHA256.HashData(otherAfter)))
                throw new InvalidOperationException("Preservation verification failed. No fallback deletion was attempted.");
        }
        finally { await Scalar("SELECT RELEASE_LOCK('pact0.2_db:client-writes')"); await Scalar("SELECT RELEASE_LOCK('pact0.2_db:installation')"); }
    }
    private static async Task<byte[]> AccountRows(MySqlConnection connection, IEnumerable<string> columns, CancellationToken ct)
    {
        var rows = new List<Dictionary<string, object?>>();
        await using var command = new MySqlCommand("SELECT " + string.Join(",", columns.Select(c => "`" + c.Replace("`", "``", StringComparison.Ordinal) + "`")) + " FROM accounts ORDER BY id", connection);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) { var row = new Dictionary<string, object?>(); for (var i = 0; i < reader.FieldCount; i++) row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i); rows.Add(row); }
        return JsonSerializer.SerializeToUtf8Bytes(rows);
    }
}
