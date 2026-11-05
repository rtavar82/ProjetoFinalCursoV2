using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;
using PaCT.Api.Management;

namespace PaCT.Api.Data;

public static class ManagementDirectorySchema
{
    public const string EntriesSql = """
        CREATE TABLE IF NOT EXISTS management_entries (
          id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
          kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          active BOOLEAN NOT NULL,
          version BIGINT NOT NULL,
          data LONGBLOB NOT NULL,
          UNIQUE KEY UX_management_identity(kind,identity_hash),
          INDEX IX_management_kind_active(kind,active),
          CONSTRAINT CK_management_kind CHECK (kind IN ('Supplier','ExpenseCategory')),
          CONSTRAINT CK_management_version CHECK (version > 0)
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
        """;
    // Deliberately independent of the live row: an unused entry may be deleted without deleting its audit.
    public const string HistorySql = """
        CREATE TABLE IF NOT EXISTS management_entry_history (
          entry_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          version BIGINT NOT NULL,
          action VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          data LONGBLOB NOT NULL,
          PRIMARY KEY(entry_id,version),
          INDEX IX_management_history_kind(kind)
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
        """;
    public static async Task<object> PrepareAsync(DatabaseConnectionSettings settings, InstallationPaths paths,
        IDataProtectionProvider protection, IdentitySecurity security, CancellationToken ct)
    {
        if (System.Diagnostics.Process.GetProcessesByName("PaCT.Api").Any(p => p.Id != Environment.ProcessId))
            throw new InvalidOperationException("Para a API antes de preparar a Gestão da aplicação.");
        await using var connection = InitialIdentitySchema.CreatePreparationConnection(settings); await connection.OpenAsync(ct);
        async Task<object?> Scalar(string sql) { await using var query = new MySqlCommand(sql, connection); return await query.ExecuteScalarAsync(ct); }
        if ((string?)await Scalar("SELECT DATABASE()") != DatabaseConnectionSettings.ExpectedDatabaseName) throw new InvalidOperationException("Base de dados inesperada.");
        if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:installation',0)")) != 1) throw new InvalidOperationException("Existe outra preparação em curso.");
        try
        {
            if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:client-writes',5)")) != 1) throw new InvalidOperationException("Existe outra operação em curso.");
            var tables = new List<string>();
            await using (var query = new MySqlCommand("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME", connection))
            await using (var reader = await query.ExecuteReaderAsync(ct)) while (await reader.ReadAsync(ct)) tables.Add(reader.GetString(0));
            if (!tables.Contains("client_commands")) throw new InvalidOperationException("Prepara primeiro a recuperação de operações já existente.");
            var preserved = tables.Where(t => t is not ("management_entries" or "management_entry_history")).ToArray();
            var before = await TherapistInvitationSchema.SnapshotAsync(connection, preserved, ct);
            await SchemaBackup.SaveVerifiedAsync(before, "management-directory-additive", paths, protection, ct);
            foreach (var sql in new[] { EntriesSql, HistorySql }) { await using var create = new MySqlCommand(sql, connection); await create.ExecuteNonQueryAsync(ct); }
            var seeded = 0;
            // A rerun preserves edited/deactivated/deleted categories. Seed only a genuinely unused directory.
            if (Convert.ToInt32(await Scalar("SELECT (SELECT COUNT(*) FROM management_entries)+(SELECT COUNT(*) FROM management_entry_history)")) == 0)
            {
                await using var transaction = await connection.BeginTransactionAsync(ct);
                var store = new MySqlManagementStore(settings, security, TimeProvider.System);
                foreach (var name in ManagementDirectory.InitialCategories)
                {
                    var entry = ManagementDirectory.Apply("ExpenseCategory", Guid.NewGuid().ToString("D"), null, new("Save", Name: name), "installation", DateTimeOffset.UtcNow);
                    await store.Persist(connection, transaction, null, entry, "Created", ct); seeded++;
                }
                await transaction.CommitAsync(ct);
            }
            var after = await TherapistInvitationSchema.SnapshotAsync(connection, preserved, ct);
            if (!SHA256.HashData(before).SequenceEqual(SHA256.HashData(after))) throw new InvalidOperationException("Falhou a verificação de preservação dos dados anteriores.");
            var verified = await new MySqlManagementStore(settings, security, TimeProvider.System).ListAsync("ExpenseCategory", null, "All", 1, ct);
            return new { status = "prepared", module = "management-directory", categoriesAdded = seeded, categoriesTotal = verified.Total, existingDataPreserved = true, suppliersAdded = 0 };
        }
        finally { await Scalar("SELECT RELEASE_LOCK('pact0.2_db:client-writes')"); await Scalar("SELECT RELEASE_LOCK('pact0.2_db:installation')"); }
    }
}
