using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

public static class ClientAccessSchema
{
    public const string Sql = """
        CREATE TABLE account_security_actions (
          id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
          account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          person_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          created_by_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          kind VARCHAR(24) NOT NULL,status VARCHAR(24) NOT NULL,
          security_stamp CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          previous_email_hash BINARY(32) NOT NULL,email_hash BINARY(32) NULL,
          details_ciphertext MEDIUMBLOB NOT NULL,
          created_at DATETIME(6) NOT NULL,expires_at DATETIME(6) NOT NULL,completed_at DATETIME(6) NULL,
          KEY IX_account_security_actions_account (account_id,created_at),
          CONSTRAINT FK_account_security_actions_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
          CONSTRAINT FK_account_security_actions_person FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT,
          CONSTRAINT FK_account_security_actions_actor FOREIGN KEY (created_by_account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
          CONSTRAINT CK_account_security_actions_kind CHECK
            ((kind='ChangeEmail' AND email_hash IS NOT NULL AND status IN ('Pending','Confirmed','Superseded'))
              OR (kind='ResetPasskeys' AND email_hash IS NULL AND status='Applied')),
          CONSTRAINT CK_account_security_actions_dates CHECK
            (expires_at>=created_at AND (completed_at IS NULL OR completed_at>=created_at)
              AND ((status='Pending' AND completed_at IS NULL) OR (status<>'Pending' AND completed_at IS NOT NULL)))
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
        """;

    public static async Task PrepareAsync(DatabaseConnectionSettings settings, InstallationPaths paths, IDataProtectionProvider provider, CancellationToken ct)
    {
        if (System.Diagnostics.Process.GetProcessesByName("PaCT.Api").Any(process => process.Id != Environment.ProcessId))
            throw new InvalidOperationException("Stop the running API before preparing client access.");
        await using var connection = InitialIdentitySchema.CreatePreparationConnection(settings);
        await connection.OpenAsync(ct);
        async Task<object?> Scalar(string sql) { await using var command = new MySqlCommand(sql, connection); return await command.ExecuteScalarAsync(ct); }
        if ((string?)await Scalar("SELECT DATABASE()") != DatabaseConnectionSettings.ExpectedDatabaseName) throw new InvalidOperationException("Unexpected database.");
        if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:installation',0)")) != 1) throw new InvalidOperationException("Installation busy.");
        try
        {
            if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:client-writes',5)")) != 1) throw new InvalidOperationException("Application busy.");
            var tables = new List<string>();
            await using (var command = new MySqlCommand("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME", connection))
            await using (var reader = await command.ExecuteReaderAsync(ct)) while (await reader.ReadAsync(ct)) tables.Add(reader.GetString(0));
            if (!tables.Contains("account_passkeys")) throw new InvalidOperationException("Prepare Passkeys first.");
            if (tables.Contains("account_security_actions")) return;
            var before = await TherapistInvitationSchema.SnapshotAsync(connection, tables, ct);
            await SchemaBackup.SaveVerifiedAsync(before, "client-access-additive", paths, provider, ct);
            await using (var command = new MySqlCommand(Sql, connection)) await command.ExecuteNonQueryAsync(ct);
            var after = await TherapistInvitationSchema.SnapshotAsync(connection, tables, ct);
            if (!SHA256.HashData(before).SequenceEqual(SHA256.HashData(after))) throw new InvalidOperationException("Preservation verification failed.");
        }
        finally { await Scalar("SELECT RELEASE_LOCK('pact0.2_db:client-writes')"); await Scalar("SELECT RELEASE_LOCK('pact0.2_db:installation')"); }
    }
}
