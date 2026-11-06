using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

internal static class ManagerTaskSchema
{
    internal const string CreateSql = """
        CREATE TABLE IF NOT EXISTS manager_tasks (
            id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
            body LONGBLOB NOT NULL,
            priority_high BOOLEAN NOT NULL,
            created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            created_at DATETIME(6) NOT NULL,
            completed_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
            completed_at DATETIME(6) NULL,
            reminder_at DATETIME(6) NULL,
            reminder_read_at DATETIME(6) NULL,
            push_state VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NULL,
            push_claimed_at DATETIME(6) NULL,
            INDEX IX_manager_task_list (completed_at, priority_high, created_at, id),
            INDEX IX_manager_task_reminder (completed_at, reminder_read_at, reminder_at),
            INDEX IX_manager_task_push (push_state, reminder_at)
        ) ENGINE=InnoDB
        """;

    internal static async Task PrepareAsync(DatabaseConnectionSettings settings, InstallationPaths paths,
        IDataProtectionProvider protection, CancellationToken ct)
    {
        await using var connection = InitialIdentitySchema.CreatePreparationConnection(settings);
        await connection.OpenAsync(ct);
        await using var gate = new MySqlCommand("SELECT GET_LOCK('pact0.2_db:installation',0)", connection);
        if (Convert.ToInt32(await gate.ExecuteScalarAsync(ct)) != 1)
            throw new InvalidOperationException("Existe outra preparação em curso.");
        try
        {
            var tables = new List<string>();
            await using (var query = new MySqlCommand("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME", connection))
            await using (var reader = await query.ExecuteReaderAsync(ct))
                while (await reader.ReadAsync(ct)) tables.Add(reader.GetString(0));
            if (!tables.Contains("accounts")) throw new InvalidOperationException("Prepara primeiro a instalação da PaCT.");
            if (tables.Contains("manager_tasks")) return;

            var backup = await TherapistInvitationSchema.SnapshotAsync(connection, tables, ct);
            await SchemaBackup.SaveVerifiedAsync(backup, "manager-tasks-additive", paths, protection, ct);
            await using var create = new MySqlCommand(CreateSql, connection);
            await create.ExecuteNonQueryAsync(ct);
        }
        finally
        {
            await using var release = new MySqlCommand("SELECT RELEASE_LOCK('pact0.2_db:installation')", connection);
            await release.ExecuteScalarAsync(CancellationToken.None);
        }
    }
}
