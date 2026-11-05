using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

public static class FinancialSalesSchema
{
    public const string Sql = """
        CREATE TABLE financial_sales (
          id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
          person_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
          data JSON NOT NULL,
          INDEX IX_financial_sales_person(person_id),
          CONSTRAINT FK_financial_sales_person FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE RESTRICT,
          CONSTRAINT CK_financial_sales_total CHECK (CAST(JSON_UNQUOTE(JSON_EXTRACT(data,'$.Total')) AS DECIMAL(18,2)) > 0)
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
        """;

    public static async Task<object> PrepareAsync(DatabaseConnectionSettings settings, InstallationPaths paths,
        IDataProtectionProvider protection, CancellationToken ct)
    {
        if (System.Diagnostics.Process.GetProcessesByName("PaCT.Api").Any(p => p.Id != Environment.ProcessId))
            throw new InvalidOperationException("Para a API antes de preparar a área de vendas.");
        await using var connection = InitialIdentitySchema.CreatePreparationConnection(settings);
        await connection.OpenAsync(ct);
        async Task<object?> Scalar(string sql) { await using var query = new MySqlCommand(sql, connection); return await query.ExecuteScalarAsync(ct); }
        if ((string?)await Scalar("SELECT DATABASE()") != DatabaseConnectionSettings.ExpectedDatabaseName) throw new InvalidOperationException("Base de dados inesperada.");
        if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:installation',0)")) != 1) throw new InvalidOperationException("Existe outra preparação em curso.");
        try
        {
            if (Convert.ToInt32(await Scalar("SELECT GET_LOCK('pact0.2_db:client-writes',5)")) != 1) throw new InvalidOperationException("A aplicação tem uma operação em curso.");
            var tables = new List<string>();
            await using (var query = new MySqlCommand("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME", connection))
            await using (var reader = await query.ExecuteReaderAsync(ct)) while (await reader.ReadAsync(ct)) tables.Add(reader.GetString(0));
            if (tables.Contains("financial_sales")) return new { status = "already-prepared", existingDataPreserved = true };
            var before = await TherapistInvitationSchema.SnapshotAsync(connection, tables, ct);
            await SchemaBackup.SaveVerifiedAsync(before, "financial-sales-additive", paths, protection, ct);
            await using (var create = new MySqlCommand(Sql, connection)) await create.ExecuteNonQueryAsync(ct);
            var after = await TherapistInvitationSchema.SnapshotAsync(connection, tables, ct);
            if (!SHA256.HashData(before).SequenceEqual(SHA256.HashData(after))) throw new InvalidOperationException("A verificação de preservação dos dados falhou.");
            return new { status = "prepared", table = "financial_sales", existingDataPreserved = true };
        }
        finally
        {
            await Scalar("SELECT RELEASE_LOCK('pact0.2_db:client-writes')");
            await Scalar("SELECT RELEASE_LOCK('pact0.2_db:installation')");
        }
    }
}
