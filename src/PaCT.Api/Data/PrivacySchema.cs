using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

public static class PrivacySchema
{
    private const string Documents = """
        CREATE TABLE IF NOT EXISTS privacy_documents (
            version BIGINT NOT NULL PRIMARY KEY,
            revision BIGINT NOT NULL DEFAULT 0,
            content MEDIUMTEXT NULL,
            author_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
            recorded_at DATETIME(6) NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """;
    private const string Choices = """
        CREATE TABLE IF NOT EXISTS privacy_choices (
            id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            document_version BIGINT NOT NULL,
            purpose VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            accepted BOOLEAN NOT NULL,
            decided_at DATETIME(6) NOT NULL,
            UNIQUE KEY UX_privacy_operation (account_id, operation_id),
            KEY IX_privacy_choice (account_id, purpose, id),
            CONSTRAINT FK_privacy_choice_document FOREIGN KEY (document_version) REFERENCES privacy_documents(version)
        ) ENGINE=InnoDB
        """;

    public static async Task PrepareAsync(DatabaseConnectionSettings settings, InstallationPaths paths,
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
            await using (var rows = await query.ExecuteReaderAsync(ct))
                while (await rows.ReadAsync(ct)) tables.Add(rows.GetString(0));
            if (!tables.Contains("accounts")) throw new InvalidOperationException("Prepara primeiro a instalação da PaCT.");
            if (!tables.Contains("privacy_documents") || !tables.Contains("privacy_choices"))
            {
                var backup = await TherapistInvitationSchema.SnapshotAsync(connection, tables, ct);
                await SchemaBackup.SaveVerifiedAsync(backup, "privacy-additive", paths, protection, ct);
            }
            foreach (var sql in new[] { Documents, Choices,
                "INSERT INTO privacy_documents(version) VALUES(0) ON DUPLICATE KEY UPDATE version=0" })
            {
                await using var command = new MySqlCommand(sql, connection);
                await command.ExecuteNonQueryAsync(ct);
            }
        }
        finally
        {
            await using var release = new MySqlCommand("SELECT RELEASE_LOCK('pact0.2_db:installation')", connection);
            await release.ExecuteScalarAsync(CancellationToken.None);
        }
    }
}
