using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

// Explicit local installation command; never called by HTTP or normal startup.
public static class ManagerPasskeyReset
{
    public static async Task<int> ExecuteAsync(DatabaseConnectionSettings settings, InstallationPaths paths,
        IDataProtectionProvider provider, CancellationToken ct)
    {
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
            var count = Convert.ToInt32(await Scalar("SELECT COUNT(*) FROM accounts WHERE role IN ('TechnicalManager','TherapistManager') AND closed_at IS NULL"));
            if (count != 2) throw new InvalidOperationException("This explicit reset is restricted to the two approved manager accounts.");
            var before = await TherapistInvitationSchema.SnapshotAsync(connection, tables.Where(t => t != "accounts"), ct);
            var accountsBefore = await PreservedAccounts(connection, null, ct);
            await SchemaBackup.SaveVerifiedAsync(await TherapistInvitationSchema.SnapshotAsync(connection, tables, ct), "manager-passkey-reset", paths, provider, ct);
            await using var tx = await connection.BeginTransactionAsync(ct);
            // Keep existing Passkeys, passwords, email proof, IDs and every business reference.
            await using var update = new MySqlCommand("""
                UPDATE accounts SET authenticator_secret=NULL,two_factor_enabled_at=NULL,last_totp_step=NULL,
                  recovery_code_hashes=NULL,security_stamp=UUID(),updated_at=GREATEST(updated_at,UTC_TIMESTAMP(6)),version=version+1
                WHERE role IN ('TechnicalManager','TherapistManager') AND closed_at IS NULL
                  AND (authenticator_secret IS NOT NULL OR two_factor_enabled_at IS NOT NULL OR last_totp_step IS NOT NULL OR recovery_code_hashes IS NOT NULL)
                """, connection, tx);
            var changed = await update.ExecuteNonQueryAsync(ct);
            var after = await TherapistInvitationSchema.SnapshotAsync(connection, tables.Where(t => t != "accounts"), ct, tx);
            var accountsAfter = await PreservedAccounts(connection, tx, ct);
            if (!SHA256.HashData(before).SequenceEqual(SHA256.HashData(after)) || !SHA256.HashData(accountsBefore).SequenceEqual(SHA256.HashData(accountsAfter)))
                throw new InvalidOperationException("Business preservation check failed.");
            await tx.CommitAsync(ct);
            return changed;
        }
        finally { await Scalar("SELECT RELEASE_LOCK('pact0.2_db:client-writes')"); await Scalar("SELECT RELEASE_LOCK('pact0.2_db:installation')"); }
    }

    private static async Task<byte[]> PreservedAccounts(MySqlConnection connection, MySqlTransaction? transaction, CancellationToken ct)
    {
        var mutable = new HashSet<string>(StringComparer.Ordinal) { "authenticator_secret", "two_factor_enabled_at", "last_totp_step", "recovery_code_hashes", "security_stamp", "updated_at", "version" };
        var rows = new List<Dictionary<string, object?>>();
        await using var command = new MySqlCommand("SELECT * FROM accounts ORDER BY id", connection, transaction);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var manager = reader.GetString(reader.GetOrdinal("role")) is Roles.TechnicalManager or Roles.TherapistManager;
            var row = new Dictionary<string, object?>();
            for (var column = 0; column < reader.FieldCount; column++)
                if (!manager || !mutable.Contains(reader.GetName(column))) row[reader.GetName(column)] = reader.IsDBNull(column) ? null : reader.GetValue(column);
            rows.Add(row);
        }
        return JsonSerializer.SerializeToUtf8Bytes(rows);
    }
}
