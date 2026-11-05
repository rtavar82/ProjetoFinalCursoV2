using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

public static class ExpenseSchema
{
    public static readonly (string Name, string Sql)[] Tables =
    [
        ("financial_expenses", """
        CREATE TABLE financial_expenses (
          id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
          version BIGINT NOT NULL, data LONGBLOB NOT NULL,
          CONSTRAINT CK_expense_version CHECK(version > 0)
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
        """),
        ("financial_expense_references", """
        CREATE TABLE financial_expense_references (
          expense_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          entry_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          PRIMARY KEY(expense_id,entry_id),
          CONSTRAINT FK_expense_ref_expense FOREIGN KEY(expense_id) REFERENCES financial_expenses(id) ON DELETE RESTRICT,
          CONSTRAINT FK_expense_ref_directory FOREIGN KEY(entry_id) REFERENCES management_entries(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
        """),
        ("financial_expense_history", """
        CREATE TABLE financial_expense_history (
          expense_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          version BIGINT NOT NULL, data LONGBLOB NOT NULL,
          PRIMARY KEY(expense_id,version),
          CONSTRAINT FK_expense_history FOREIGN KEY(expense_id) REFERENCES financial_expenses(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
        """),
        ("financial_expense_documents", """
        CREATE TABLE financial_expense_documents (
          id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
          expense_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          data LONGBLOB NOT NULL,
          CONSTRAINT FK_expense_document FOREIGN KEY(expense_id) REFERENCES financial_expenses(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
        """)
    ];
    public static async Task<object> PrepareAsync(DatabaseConnectionSettings settings, InstallationPaths paths, IDataProtectionProvider protection, CancellationToken ct)
    {
        if (System.Diagnostics.Process.GetProcessesByName("PaCT.Api").Any(p => p.Id != Environment.ProcessId))
            throw new InvalidOperationException("Para a API antes de preparar as despesas.");
        await using var connection = InitialIdentitySchema.CreatePreparationConnection(settings); await connection.OpenAsync(ct);
        async Task<object?> Scalar(string sql) { await using var query = new MySqlCommand(sql, connection); return await query.ExecuteScalarAsync(ct); }
        if ((string?)await Scalar("SELECT DATABASE()") != DatabaseConnectionSettings.ExpectedDatabaseName) throw new InvalidOperationException("Base de dados inesperada.");
        if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:installation',0)")) != 1) throw new InvalidOperationException("Existe outra preparação em curso.");
        try
        {
            if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:client-writes',5)")) != 1) throw new InvalidOperationException("Existe uma gravação em curso.");
            if (Convert.ToInt32(await Scalar("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('management_entries','management_entry_history','client_commands')")) != 3)
                throw new InvalidOperationException("Prepara primeiro a Gestão da aplicação e a proteção de repetição dos envios.");
            var tables = new List<string>();
            await using (var query = new MySqlCommand("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME", connection))
            await using (var reader = await query.ExecuteReaderAsync(ct)) while (await reader.ReadAsync(ct)) tables.Add(reader.GetString(0));
            var missing = Tables.Where(t => !tables.Contains(t.Name)).ToArray();
            if (missing.Length == 0) return new { status = "already-prepared", existingDataPreserved = true };
            var before = await TherapistInvitationSchema.SnapshotAsync(connection, tables, ct);
            await SchemaBackup.SaveVerifiedAsync(before, "financial-expenses-additive", paths, protection, ct);
            foreach (var table in missing) { await using var create = new MySqlCommand(table.Sql, connection); await create.ExecuteNonQueryAsync(ct); }
            var after = await TherapistInvitationSchema.SnapshotAsync(connection, tables, ct);
            if (!SHA256.HashData(before).SequenceEqual(SHA256.HashData(after))) throw new InvalidOperationException("A verificação de preservação dos dados falhou.");
            return new { status = "prepared", tables = missing.Select(t => t.Name), existingDataPreserved = true };
        }
        finally { await Scalar("SELECT RELEASE_LOCK('pact0.2_db:client-writes')"); await Scalar("SELECT RELEASE_LOCK('pact0.2_db:installation')"); }
    }
}
