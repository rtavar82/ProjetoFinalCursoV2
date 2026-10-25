using System.Data;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;

namespace PaCT.Api.Data;

/// <summary>Explicit preparation of an empty database; never invoked by normal application startup.</summary>
public static class InitialIdentitySchema
{
    public const string PeopleSql = """
        CREATE TABLE `people` (
            `id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `first_name_ciphertext` VARBINARY(512) NOT NULL,
            `last_name_ciphertext` VARBINARY(512) NOT NULL,
            `locality` VARCHAR(150) NOT NULL,
            `birth_date` DATE NULL,
            `gender` VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NULL,
            `email_ciphertext` VARBINARY(1280) NULL,
            `email_hash` BINARY(32) NULL,
            `dial_code_ciphertext` VARBINARY(128) NULL,
            `phone_ciphertext` VARBINARY(128) NULL,
            `phone_hash` BINARY(32) NULL,
            `address_ciphertext` VARBINARY(4096) NULL,
            `children_count` SMALLINT UNSIGNED NULL,
            `relationship_status` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
            `is_active` TINYINT UNSIGNED NOT NULL DEFAULT 1,
            `created_at` DATETIME(6) NOT NULL,
            `updated_at` DATETIME(6) NOT NULL,
            `version` BIGINT UNSIGNED NOT NULL DEFAULT 1,
            PRIMARY KEY (`id`),
            KEY `IX_people_email_hash` (`email_hash`),
            KEY `IX_people_phone_hash` (`phone_hash`),
            CONSTRAINT `CK_people_names` CHECK (OCTET_LENGTH(`first_name_ciphertext`) > 0 AND OCTET_LENGTH(`last_name_ciphertext`) > 0),
            CONSTRAINT `CK_people_locality` CHECK (CHAR_LENGTH(TRIM(`locality`)) > 0),
            CONSTRAINT `CK_people_email` CHECK ((`email_ciphertext` IS NULL AND `email_hash` IS NULL) OR (`email_ciphertext` IS NOT NULL AND OCTET_LENGTH(`email_ciphertext`) > 0 AND `email_hash` IS NOT NULL)),
            CONSTRAINT `CK_people_phone` CHECK ((`dial_code_ciphertext` IS NULL AND `phone_ciphertext` IS NULL AND `phone_hash` IS NULL) OR (`dial_code_ciphertext` IS NOT NULL AND OCTET_LENGTH(`dial_code_ciphertext`) > 0 AND `phone_ciphertext` IS NOT NULL AND OCTET_LENGTH(`phone_ciphertext`) > 0 AND `phone_hash` IS NOT NULL)),
            CONSTRAINT `CK_people_contact` CHECK (`email_ciphertext` IS NOT NULL OR `phone_ciphertext` IS NOT NULL),
            CONSTRAINT `CK_people_address` CHECK (`address_ciphertext` IS NULL OR OCTET_LENGTH(`address_ciphertext`) > 0),
            CONSTRAINT `CK_people_gender` CHECK (`gender` IS NULL OR `gender` IN ('Male', 'Female')),
            CONSTRAINT `CK_people_relationship` CHECK (`relationship_status` IS NULL OR `relationship_status` IN ('Married', 'Partnered', 'Unpartnered')),
            CONSTRAINT `CK_people_state` CHECK (`is_active` IN (0, 1) AND `version` > 0),
            CONSTRAINT `CK_people_dates` CHECK (`updated_at` >= `created_at`)
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
        """;

    public const string AccountsSql = """
        CREATE TABLE `accounts` (
            `id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `origin_person_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `role` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `display_name` VARCHAR(201) NOT NULL,
            `password_hash` VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `email_login_hash` BINARY(32) NOT NULL,
            `phone_login_hash` BINARY(32) NULL,
            `email_confirmed_at` DATETIME(6) NULL,
            `link_status` VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `link_verified_at` DATETIME(6) NULL,
            `link_verified_by_account_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
            `failed_sign_in_count` INT UNSIGNED NOT NULL DEFAULT 0,
            `lockout_end` DATETIME(6) NULL,
            `security_stamp` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `created_at` DATETIME(6) NOT NULL,
            `updated_at` DATETIME(6) NOT NULL,
            `closed_at` DATETIME(6) NULL,
            `version` BIGINT UNSIGNED NOT NULL DEFAULT 1,
            `authenticator_secret` VARBINARY(512) NULL,
            `two_factor_enabled_at` DATETIME(6) NULL,
            `last_totp_step` BIGINT NULL,
            `recovery_code_hashes` JSON NULL,
            `active_email_hash` BINARY(32) GENERATED ALWAYS AS (IF(`closed_at` IS NULL, `email_login_hash`, NULL)) STORED,
            `active_phone_hash` BINARY(32) GENERATED ALWAYS AS (IF(`closed_at` IS NULL, `phone_login_hash`, NULL)) STORED,
            `permanent_manager_role` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (IF(`role` IN ('TechnicalManager', 'TherapistManager'), `role`, NULL)) STORED,
            PRIMARY KEY (`id`),
            UNIQUE KEY `UQ_accounts_origin_person` (`origin_person_id`),
            UNIQUE KEY `UQ_accounts_active_email` (`active_email_hash`),
            UNIQUE KEY `UQ_accounts_active_phone` (`active_phone_hash`),
            UNIQUE KEY `UQ_accounts_permanent_manager` (`permanent_manager_role`),
            CONSTRAINT `FK_accounts_origin_person` FOREIGN KEY (`origin_person_id`) REFERENCES `people` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT `FK_accounts_verifier` FOREIGN KEY (`link_verified_by_account_id`) REFERENCES `accounts` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT `CK_accounts_role` CHECK (`role` IN ('TechnicalManager', 'TherapistManager', 'Client')),
            CONSTRAINT `CK_accounts_fields` CHECK (CHAR_LENGTH(TRIM(`display_name`)) > 0 AND CHAR_LENGTH(TRIM(`password_hash`)) > 0 AND CHAR_LENGTH(TRIM(`security_stamp`)) > 0 AND `version` > 0),
            CONSTRAINT `CK_accounts_link_status` CHECK (`link_status` IN ('Pending', 'Verified', 'Rejected')),
            CONSTRAINT `CK_accounts_verification` CHECK ((`link_status` = 'Verified') = (`link_verified_at` IS NOT NULL) AND (`link_verified_by_account_id` IS NULL OR `link_status` = 'Verified')),
            CONSTRAINT `CK_accounts_two_factor` CHECK (`two_factor_enabled_at` IS NULL OR (`authenticator_secret` IS NOT NULL AND `last_totp_step` IS NOT NULL AND `recovery_code_hashes` IS NOT NULL)),
            CONSTRAINT `CK_accounts_dates` CHECK (`updated_at` >= `created_at` AND (`email_confirmed_at` IS NULL OR `email_confirmed_at` >= `created_at`) AND (`link_verified_at` IS NULL OR `link_verified_at` >= `created_at`) AND (`closed_at` IS NULL OR `closed_at` >= `created_at`))
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
        """;

    public const string SecurityEmailsSql = """
        CREATE TABLE `security_emails` (
            `id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `account_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `payload_ciphertext` VARBINARY(8192) NOT NULL,
            `state` VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            `created_at` DATETIME(6) NOT NULL,
            `updated_at` DATETIME(6) NOT NULL,
            `attempted_at` DATETIME(6) NULL,
            PRIMARY KEY (`id`),
            KEY `IX_security_emails_pending` (`state`, `created_at`),
            CONSTRAINT `FK_security_emails_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT `CK_security_emails_state` CHECK (`state` IN ('Pending', 'Sending', 'Submitted', 'Failed', 'Uncertain', 'Cancelled'))
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
        """;

    public static IReadOnlyList<string> Statements { get; } = Array.AsReadOnly(new[] { PeopleSql, AccountsSql, SecurityEmailsSql });

    private const string LockName = "pact0.2_db:initial-identity-schema";

    public static MySqlConnection CreatePreparationConnection(DatabaseConnectionSettings settings)
    {
        var connection = settings.CreateConnection();
        connection.ConnectionString = new MySqlConnectionStringBuilder(connection.ConnectionString) { Pooling = false }.ConnectionString;
        return connection;
    }

    public static async Task<SchemaPreparationResult> CreateAsync(DatabaseConnectionSettings settings, CancellationToken ct)
    {
        var phase = "abrir ligação";
        var created = 0;
        try
        {
            await using var connection = CreatePreparationConnection(settings);
            await connection.OpenAsync(ct);
            phase = "confirmar base autorizada";
            var database = await ScalarAsync(connection, "SELECT DATABASE()", ct) as string;
            if (!string.Equals(database, DatabaseConnectionSettings.ExpectedDatabaseName, StringComparison.Ordinal))
                throw Failure(phase, created, "A base selecionada não é pact0.2_db.");

            phase = "obter exclusão da preparação";
            await using var lockCommand = connection.CreateCommand();
            lockCommand.CommandText = "SELECT GET_LOCK(@name, 0)";
            lockCommand.Parameters.AddWithValue("@name", LockName);
            if (Convert.ToInt32(await lockCommand.ExecuteScalarAsync(ct)) != 1)
                throw Failure(phase, created, "Outra preparação está em curso ou não foi possível obter exclusão.");
            try
            {
                phase = "verificar base vazia";
                if ((await ReadTablesAsync(connection, ct)).Count != 0)
                    throw Failure(phase, created, "A base contém tabelas ou vistas. A preparação exige uma base totalmente vazia.");

                foreach (var sql in Statements)
                {
                    var table = TableName(sql);
                    phase = "criar " + table;
                    await using var command = connection.CreateCommand();
                    command.CommandText = sql;
                    await command.ExecuteNonQueryAsync(ct);
                    created++;
                }

                phase = "verificar estrutura e ausência de dados";
                var tables = await ReadTablesAsync(connection, ct);
                if (tables.Count != Statements.Count || Statements.Any(sql => !tables.Contains(TableName(sql), StringComparer.OrdinalIgnoreCase)))
                    throw Failure(phase, created, "A estrutura final não corresponde às tabelas esperadas.");

                var result = new List<PreparedSchemaTable>();
                foreach (var sql in Statements)
                {
                    var table = TableName(sql);
                    await VerifyColumnsAsync(connection, table, sql, ct);
                    var rows = Convert.ToInt64(await ScalarAsync(connection, $"SELECT COUNT(*) FROM `{table}`", ct));
                    if (rows != 0)
                        throw Failure(phase, created, "As tabelas não estão vazias; não é possível confirmar a preparação inicial.");
                    result.Add(new(table, rows));
                }
                return new(database!, result.AsReadOnly());
            }
            finally
            {
                await ReleaseLockAsync(connection);
            }
        }
        catch (SchemaPreparationException)
        {
            throw;
        }
        catch (Exception)
        {
            // Connector messages may contain credentials, SQL or private values: retain none of them.
            throw Failure(phase, created, "Não foi possível concluir a preparação explícita.");
        }
    }

    private static SchemaPreparationException Failure(string phase, int created, string reason) =>
        new(phase, created, reason);

    private static string TableName(string sql) => sql.Split('`')[1];

    private static IEnumerable<string> ColumnNames(string sql) => sql.Split('\n')
        .Select(line => line.TrimStart())
        .Where(line => line.StartsWith('`'))
        .Select(line => line.Split('`')[1]);

    private static async Task<object?> ScalarAsync(MySqlConnection connection, string sql, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return await command.ExecuteScalarAsync(ct);
    }

    private static async Task<List<string>> ReadTablesAsync(MySqlConnection connection, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()";
        await using var reader = await command.ExecuteReaderAsync(ct);
        // MySQL on Windows may normalize table-name casing; this does not weaken the exact database-name guard.
        var tables = new List<string>();
        while (await reader.ReadAsync(ct)) tables.Add(reader.GetString(0));
        return tables;
    }

    private static async Task VerifyColumnsAsync(MySqlConnection connection, string table, string sql, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @table ORDER BY ORDINAL_POSITION";
        command.Parameters.AddWithValue("@table", table);
        await using var reader = await command.ExecuteReaderAsync(ct);
        var columns = new List<string>();
        while (await reader.ReadAsync(ct)) columns.Add(reader.GetString(0));
        if (!ColumnNames(sql).SequenceEqual(columns, StringComparer.Ordinal))
            throw Failure("verificar estrutura e ausência de dados", Statements.Count, "As colunas finais não correspondem à estrutura esperada.");
    }

    private static async Task ReleaseLockAsync(MySqlConnection connection)
    {
        if (connection.State != ConnectionState.Open) return;
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT RELEASE_LOCK(@name)";
            command.Parameters.AddWithValue("@name", LockName);
            await command.ExecuteScalarAsync(CancellationToken.None);
        }
        catch (Exception)
        {
            // Closing this dedicated connection also releases its advisory lock; never leak connector diagnostics.
        }
    }
}

public sealed record PreparedSchemaTable(string Name, long RowCount);

public sealed record SchemaPreparationResult(string Database, IReadOnlyList<PreparedSchemaTable> Tables);

public sealed class SchemaPreparationException : Exception
{
    public string Phase { get; }
    public int CreatedTables { get; }

    internal SchemaPreparationException(string phase, int createdTables, string reason)
        : base($"{reason} Fase: {phase}. Criações confirmadas: {createdTables} de {InitialIdentitySchema.Statements.Count}. " +
            (createdTables > 0 || phase.StartsWith("criar ", StringComparison.Ordinal)
                ? "Podem existir alterações DDL parciais; nenhuma tabela foi apagada ou revertida."
                : "Nenhuma tabela foi criada por esta operação."))
    {
        Phase = phase;
        CreatedTables = createdTables;
    }
}
