using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

public static class SecurityAuditSchema
{
    public const string Sql = """
        CREATE TABLE `security_audit_events` (
            `id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `occurred_at` DATETIME(6) NOT NULL,
            `event_type` VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `outcome` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `severity` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `actor_account_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
            `actor_role` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
            `request_id` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
            `http_method` VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NULL,
            `route` VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
            `status_code` SMALLINT UNSIGNED NULL,
            `detail` VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL,
            `resource_id` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
            PRIMARY KEY (`id`),
            KEY `IX_security_audit_occurred` (`occurred_at`, `id`),
            KEY `IX_security_audit_type` (`event_type`, `occurred_at`),
            KEY `IX_security_audit_outcome` (`outcome`, `occurred_at`),
            KEY `IX_security_audit_actor` (`actor_account_id`, `occurred_at`),
            CONSTRAINT `CK_security_audit_outcome` CHECK (`outcome` IN ('Success','Failure','Denied','Blocked','Uncertain','Error','Observed')),
            CONSTRAINT `CK_security_audit_severity` CHECK (`severity` IN ('Info','Warning','High','Critical')),
            CONSTRAINT `CK_security_audit_status` CHECK (`status_code` IS NULL OR `status_code` BETWEEN 100 AND 599)
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
        """;

    public static async Task<PreparedSchemaTable> PrepareAsync(DatabaseConnectionSettings settings, InstallationPaths paths,
        IDataProtectionProvider provider, CancellationToken ct)
    {
        var phase = "confirmar que a API está parada";
        try
        {
            if (System.Diagnostics.Process.GetProcessesByName("PaCT.Api").Any(p => p.Id != Environment.ProcessId))
                throw new InvalidOperationException();
            phase = "ligar à base de dados configurada";
            await using var connection = InitialIdentitySchema.CreatePreparationConnection(settings);
            await connection.OpenAsync(ct);
            if ((string?)await Scalar(connection, "SELECT DATABASE()", ct) != DatabaseConnectionSettings.ExpectedDatabaseName)
                throw new InvalidOperationException();
            phase = "obter acesso exclusivo à instalação";
            if (Convert.ToInt32(await Scalar(connection, "SELECT GET_LOCK('pact0.2_db:installation',0)", ct)) != 1)
                throw new InvalidOperationException();
            try
            {
                if (Convert.ToInt32(await Scalar(connection, "SELECT GET_LOCK('pact0.2_db:client-writes',5)", ct)) != 1)
                    throw new InvalidOperationException();
                try
                {
                    phase = "verificar o esquema existente";
                    var tables = await Tables(connection, ct);
                    if (!tables.Contains("accounts")) throw new InvalidOperationException();
                    if (tables.Contains("security_audit_events")) return await VerifyAsync(connection, ct);

                    phase = "ler os dados para a cópia de segurança";
                    var before = await TherapistInvitationSchema.SnapshotAsync(connection, tables, ct);
                    phase = "gravar e verificar a cópia de segurança protegida";
                    await SchemaBackup.SaveVerifiedAsync(before, "security-audit", paths, provider, ct);
                    phase = "criar a tabela de auditoria";
                    await using (var create = new MySqlCommand(Sql, connection)) await create.ExecuteNonQueryAsync(ct);
                    phase = "verificar a tabela criada e a preservação dos dados";
                    var result = await VerifyAsync(connection, ct);
                    var after = await TherapistInvitationSchema.SnapshotAsync(connection, tables, ct);
                    if (!SHA256.HashData(before).SequenceEqual(SHA256.HashData(after)))
                        throw new InvalidOperationException();
                    return result;
                }
                finally { await Scalar(connection, "SELECT RELEASE_LOCK('pact0.2_db:client-writes')", CancellationToken.None); }
            }
            finally { await Scalar(connection, "SELECT RELEASE_LOCK('pact0.2_db:installation')", CancellationToken.None); }
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            // Expose the fixed phase and connector code only. Raw exceptions can contain private values.
            throw new PreparationException(phase, error is MySqlException mysql ? mysql.Number : null);
        }
    }

    internal sealed class PreparationException(string phase, int? mysqlCode) : Exception(
        $"Preparação da auditoria não confirmada na fase «{phase}»." +
        (mysqlCode is int code ? $" Código MySQL: {code}." : "") +
        " Verifica o estado da tabela e conserva a cópia de segurança, se criada.");

    internal static async Task<PreparedSchemaTable> VerifyAsync(MySqlConnection connection, CancellationToken ct)
    {
        var actual = new List<string>();
        await using (var command = new MySqlCommand("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='security_audit_events' ORDER BY ORDINAL_POSITION", connection))
        await using (var reader = await command.ExecuteReaderAsync(ct)) while (await reader.ReadAsync(ct)) actual.Add(reader.GetString(0));
        var expected = Sql.Split('\n').Select(line => line.TrimStart()).Where(line => line.StartsWith('`')).Select(line => line.Split('`')[1]);
        if (!expected.SequenceEqual(actual, StringComparer.Ordinal)) throw new InvalidOperationException("The security audit schema requires review; it was not replaced.");
        await using var count = new MySqlCommand("SELECT COUNT(*) FROM security_audit_events", connection);
        return new("security_audit_events", Convert.ToInt64(await count.ExecuteScalarAsync(ct)));
    }

    private static async Task<object?> Scalar(MySqlConnection connection, string sql, CancellationToken ct)
    {
        await using var command = new MySqlCommand(sql, connection); return await command.ExecuteScalarAsync(ct);
    }

    private static async Task<List<string>> Tables(MySqlConnection connection, CancellationToken ct)
    {
        var names = new List<string>();
        await using var command = new MySqlCommand("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME", connection);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) names.Add(reader.GetString(0));
        return names;
    }
}
