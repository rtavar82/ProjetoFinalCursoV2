using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;

namespace PaCT.Api.Data;

public static class SitePresentationSchema
{
    internal const string CreateSql = """
        CREATE TABLE IF NOT EXISTS site_presentation (
            version BIGINT NOT NULL PRIMARY KEY,
            author_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
            editor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
            lease_until DATETIME(6) NULL,
            published_at DATETIME(6) NULL,
            data LONGBLOB NULL,
            CONSTRAINT CK_site_presentation_revision CHECK (
                (version=0 AND published_at IS NULL AND data IS NULL)
                OR (version>0 AND editor_id IS NULL AND lease_until IS NULL AND author_id IS NOT NULL AND published_at IS NOT NULL AND data IS NOT NULL))
        ) ENGINE=InnoDB
        """;

    public static async Task PrepareAsync(DatabaseConnectionSettings settings, CancellationToken ct)
    {
        await using var connection = InitialIdentitySchema.CreatePreparationConnection(settings);
        await connection.OpenAsync(ct);
        await using var gate = new MySqlCommand("SELECT GET_LOCK('pact0.2_db:installation',0)", connection);
        if (Convert.ToInt32(await gate.ExecuteScalarAsync(ct)) != 1)
            throw new InvalidOperationException("Existe outra preparação em curso.");
        try
        {
            await using var create = new MySqlCommand(CreateSql, connection);
            await create.ExecuteNonQueryAsync(ct);
            // Version zero coordinates editing. Positive versions are immutable publications.
            await using var seed = new MySqlCommand("INSERT INTO site_presentation(version) VALUES(0) ON DUPLICATE KEY UPDATE version=0", connection);
            await seed.ExecuteNonQueryAsync(ct);
        }
        finally
        {
            await using var release = new MySqlCommand("SELECT RELEASE_LOCK('pact0.2_db:installation')", connection);
            await release.ExecuteScalarAsync(CancellationToken.None);
        }
    }
}
