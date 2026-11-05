using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

public static class SecurityEmailOperationsSchema
{
    public const string Sql = """
        CREATE TABLE security_email_reviews (
          operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
          email_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          manager_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          action VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          created_at DATETIME(6) NOT NULL,
          KEY IX_security_email_reviews_email (email_id,created_at),
          CONSTRAINT FK_security_email_reviews_email FOREIGN KEY (email_id) REFERENCES security_emails(id) ON DELETE RESTRICT,
          CONSTRAINT FK_security_email_reviews_manager FOREIGN KEY (manager_account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
          CONSTRAINT CK_security_email_reviews_action CHECK (action='Review')
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
        """;

    public static async Task PrepareAsync(DatabaseConnectionSettings settings, InstallationPaths paths, IDataProtectionProvider provider, CancellationToken ct)
    {
        if (System.Diagnostics.Process.GetProcessesByName("PaCT.Api").Any(p => p.Id != Environment.ProcessId))
            throw new InvalidOperationException("Stop the API before preparing email operations.");
        await using var connection = InitialIdentitySchema.CreatePreparationConnection(settings);
        await connection.OpenAsync(ct);
        async Task<object?> Scalar(string sql)
        {
            await using var command = new MySqlCommand(sql, connection);
            return await command.ExecuteScalarAsync(ct);
        }
        if ((string?)await Scalar("SELECT DATABASE()") != DatabaseConnectionSettings.ExpectedDatabaseName) throw new InvalidOperationException("Unexpected database.");
        if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:installation',0)")) != 1) throw new InvalidOperationException("Installation busy.");
        try
        {
            if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:client-writes',5)")) != 1) throw new InvalidOperationException("Application busy.");
            var tables = new List<string>();
            await using (var command = new MySqlCommand("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME", connection))
            await using (var reader = await command.ExecuteReaderAsync(ct))
                while (await reader.ReadAsync(ct)) tables.Add(reader.GetString(0));
            if (!tables.Contains("accounts") || !tables.Contains("security_emails")) throw new InvalidOperationException("Prepare the identity schema first.");
            if (tables.Contains("security_email_reviews"))
            {
                var columns = Convert.ToInt32(await Scalar("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='security_email_reviews' AND COLUMN_NAME IN ('operation_id','email_id','manager_account_id','action','created_at')"));
                if (columns != 5) throw new InvalidOperationException("Unexpected email operations schema; no migration attempted.");
                return;
            }

            var before = await TherapistInvitationSchema.SnapshotAsync(connection, tables, ct);
            await SchemaBackup.SaveVerifiedAsync(before, "security-email-operations", paths, provider, ct);
            await using (var command = new MySqlCommand(Sql, connection)) await command.ExecuteNonQueryAsync(ct);
            var after = await TherapistInvitationSchema.SnapshotAsync(connection, tables, ct);
            if (!SHA256.HashData(before).SequenceEqual(SHA256.HashData(after))) throw new InvalidOperationException("Preservation verification failed.");
        }
        finally
        {
            await Scalar("SELECT RELEASE_LOCK('pact0.2_db:client-writes')");
            await Scalar("SELECT RELEASE_LOCK('pact0.2_db:installation')");
        }
    }
}
