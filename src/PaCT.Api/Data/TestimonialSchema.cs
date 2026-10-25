using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;

namespace PaCT.Api.Data;

// Explicit preparation only. No content is seeded, and no existing business table is changed.
public static class TestimonialSchema
{
    internal const string CreateSql = """
        CREATE TABLE testimonials (
          id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
          is_published BOOLEAN NOT NULL,
          version BIGINT NOT NULL,
          data LONGBLOB NOT NULL,
          KEY IX_testimonials_published (is_published),
          CHECK (version > 0)
        ) ENGINE=InnoDB
        """;
    public static async Task<bool> PrepareAsync(DatabaseConnectionSettings settings, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
        await using var gate = new MySqlCommand("SELECT GET_LOCK('pact0.2_db:testimonial-writes',5)", connection);
        if (Convert.ToInt32(await gate.ExecuteScalarAsync(ct)) != 1) throw new InvalidOperationException("Testimonial preparation is busy.");
        try
        {
            await using var check = new MySqlCommand("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='testimonials'", connection);
            if (Convert.ToInt32(await check.ExecuteScalarAsync(ct)) == 0)
            { await using var create = new MySqlCommand(CreateSql, connection); await create.ExecuteNonQueryAsync(ct); return true; }
            await using var verify = new MySqlCommand("""
                SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='testimonials'
                  AND ((column_name='id' AND data_type='char' AND character_maximum_length=36 AND column_key='PRI')
                    OR (column_name='is_published' AND data_type='tinyint')
                    OR (column_name='version' AND data_type='bigint')
                    OR (column_name='data' AND data_type='longblob')) AND is_nullable='NO'
                """, connection);
            if (Convert.ToInt32(await verify.ExecuteScalarAsync(ct)) != 4) throw new InvalidOperationException("Existing testimonial table requires review. No change was made.");
            await using var foreignKeys = new MySqlCommand("SELECT COUNT(*) FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name='testimonials' AND referenced_table_name IS NOT NULL", connection);
            if (Convert.ToInt32(await foreignKeys.ExecuteScalarAsync(ct)) != 0) throw new InvalidOperationException("Testimonial relationships require review. No change was made.");
            return false;
        }
        finally
        {
            await using var release = new MySqlCommand("SELECT RELEASE_LOCK('pact0.2_db:testimonial-writes')", connection); await release.ExecuteScalarAsync(CancellationToken.None);
        }
    }
}
