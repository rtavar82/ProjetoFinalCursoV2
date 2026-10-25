using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

public static class AccountLoginSchema
{
    public const string GoogleSql = """
        CREATE TABLE account_external_logins (
          id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
          account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          provider VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          subject_hash BINARY(32) NOT NULL,identity_ciphertext MEDIUMBLOB NOT NULL,created_at DATETIME(6) NOT NULL,
          UNIQUE KEY UX_account_external_logins_subject (provider,subject_hash),
          UNIQUE KEY UX_account_external_logins_account (account_id,provider),
          CONSTRAINT FK_account_external_logins_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
          CONSTRAINT CK_account_external_logins_provider CHECK (provider='Google')
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
        """;
    private const string ActionsCheck = """
        ALTER TABLE account_security_actions DROP CHECK CK_account_security_actions_kind,
          ADD CONSTRAINT CK_account_security_actions_kind CHECK (
            (kind='ChangeEmail' AND email_hash IS NOT NULL AND status IN ('Pending','Confirmed','Superseded'))
            OR (kind='ChangePassword' AND email_hash IS NULL AND status IN ('Pending','Confirmed','Superseded'))
            OR (kind IN ('ResetPasskeys','LinkGoogle','UnlinkGoogle') AND email_hash IS NULL AND status='Applied'))
        """;
    public static async Task PrepareAsync(DatabaseConnectionSettings settings, InstallationPaths paths, IDataProtectionProvider provider, CancellationToken ct)
    {
        if (System.Diagnostics.Process.GetProcessesByName("PaCT.Api").Any(p => p.Id != Environment.ProcessId)) throw new InvalidOperationException("Stop the API first.");
        await using var connection = InitialIdentitySchema.CreatePreparationConnection(settings); await connection.OpenAsync(ct);
        async Task<object?> Scalar(string sql) { await using var command = new MySqlCommand(sql, connection); return await command.ExecuteScalarAsync(ct); }
        async Task Execute(string sql) { await using var command = new MySqlCommand(sql, connection); await command.ExecuteNonQueryAsync(ct); }
        if ((string?)await Scalar("SELECT DATABASE()") != DatabaseConnectionSettings.ExpectedDatabaseName) throw new InvalidOperationException("Unexpected database.");
        if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:installation',0)")) != 1) throw new InvalidOperationException("Installation busy.");
        try
        {
            if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:client-writes',5)")) != 1) throw new InvalidOperationException("Application busy.");
            var tables = new List<string>();
            await using (var command = new MySqlCommand("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME", connection))
            await using (var reader = await command.ExecuteReaderAsync(ct)) while (await reader.ReadAsync(ct)) tables.Add(reader.GetString(0));
            if (!tables.Contains("account_security_actions")) throw new InvalidOperationException("Prepare client access first.");
            var hasFlag = Convert.ToInt32(await Scalar("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='accounts' AND COLUMN_NAME='password_sign_in_required'")) == 1;
            var check = (string?)await Scalar("SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='CK_account_security_actions_kind'");
            var completeCheck = check is not null && check.Contains("ChangePassword", StringComparison.Ordinal) && check.Contains("LinkGoogle", StringComparison.Ordinal);
            if (hasFlag && tables.Contains("account_external_logins") && completeCheck) return;
            var columns = new Dictionary<string, string[]>();
            foreach (var table in tables)
            {
                var names = new List<string>();
                await using var command = new MySqlCommand("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@table ORDER BY ORDINAL_POSITION", connection);
                command.Parameters.AddWithValue("@table", table); await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct)) names.Add(reader.GetString(0)); columns[table] = names.ToArray();
            }
            var before = await Rows(connection, columns, ct);
            await SchemaBackup.SaveVerifiedAsync(await TherapistInvitationSchema.SnapshotAsync(connection, tables, ct), "google-password-change", paths, provider, ct);
            if (!hasFlag) await Execute("ALTER TABLE accounts ADD COLUMN password_sign_in_required BOOLEAN NOT NULL DEFAULT 0");
            if (!completeCheck) await Execute(ActionsCheck);
            if (!tables.Contains("account_external_logins")) await Execute(GoogleSql);
            var after = await Rows(connection, columns, ct);
            if (!SHA256.HashData(before).SequenceEqual(SHA256.HashData(after))) throw new InvalidOperationException("Existing values changed during preparation.");
        }
        finally { await Scalar("SELECT RELEASE_LOCK('pact0.2_db:client-writes')"); await Scalar("SELECT RELEASE_LOCK('pact0.2_db:installation')"); }
    }
    private static async Task<byte[]> Rows(MySqlConnection connection, Dictionary<string, string[]> columns, CancellationToken ct)
    {
        var data = new Dictionary<string, object>();
        foreach (var (table, fields) in columns)
        {
            var rows = new List<object?[]>();
            await using var command = new MySqlCommand("SELECT " + string.Join(",", fields.Select(f => "`" + f.Replace("`", "``", StringComparison.Ordinal) + "`"))
                + " FROM `" + table.Replace("`", "``", StringComparison.Ordinal) + "` ORDER BY id", connection);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(Enumerable.Range(0, reader.FieldCount).Select(i => reader.IsDBNull(i) ? null : reader.GetValue(i)).ToArray());
            data[table] = rows;
        }
        return JsonSerializer.SerializeToUtf8Bytes(data);
    }
}
