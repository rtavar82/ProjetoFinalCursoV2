using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

public static class ClientCommandSchema
{
    public const string Sql = """
        CREATE TABLE client_commands (
          id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
          author_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
          request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          result_ciphertext MEDIUMBLOB NOT NULL,created_at DATETIME(6) NOT NULL,
          FOREIGN KEY (author_id) REFERENCES accounts(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
        """;

    public static async Task PrepareAsync(DatabaseConnectionSettings settings, InstallationPaths paths, IDataProtectionProvider provider, CancellationToken ct)
    {
        if (System.Diagnostics.Process.GetProcessesByName("PaCT.Api").Any(p => p.Id != Environment.ProcessId))
            throw new InvalidOperationException("Stop the API before preparing request recovery.");
        await using var connection = InitialIdentitySchema.CreatePreparationConnection(settings); await connection.OpenAsync(ct);
        async Task<object?> Scalar(string sql) { await using var command = new MySqlCommand(sql, connection); return await command.ExecuteScalarAsync(ct); }
        if ((string?)await Scalar("SELECT DATABASE()") != DatabaseConnectionSettings.ExpectedDatabaseName) throw new InvalidOperationException("Unexpected database.");
        if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:installation',0)")) != 1) throw new InvalidOperationException("Installation busy.");
        try
        {
            if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:client-writes',5)")) != 1) throw new InvalidOperationException("Application busy.");
            var tables = new List<string>();
            await using (var command = new MySqlCommand("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME", connection))
            await using (var reader = await command.ExecuteReaderAsync(ct)) while (await reader.ReadAsync(ct)) tables.Add(reader.GetString(0));
            if (tables.Contains("client_commands")) return;
            var before = await TherapistInvitationSchema.SnapshotAsync(connection, tables, ct);
            await SchemaBackup.SaveVerifiedAsync(before, "request-recovery-additive", paths, provider, ct);
            await using (var command = new MySqlCommand(Sql, connection)) await command.ExecuteNonQueryAsync(ct);
            var after = await TherapistInvitationSchema.SnapshotAsync(connection, tables, ct);
            if (!SHA256.HashData(before).SequenceEqual(SHA256.HashData(after))) throw new InvalidOperationException("Preservation verification failed.");
        }
        finally { await Scalar("SELECT RELEASE_LOCK('pact0.2_db:client-writes')"); await Scalar("SELECT RELEASE_LOCK('pact0.2_db:installation')"); }
    }
}
