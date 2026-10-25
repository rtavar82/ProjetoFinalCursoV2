using System.Security.Cryptography;
using System.Text.Json;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

public static class EnglishIdentityUpgrade
{
    private const string PeopleMap = "Id=id;PrimeiroNomeCifrado=first_name_ciphertext;UltimoNomeCifrado=last_name_ciphertext;Localidade=locality;DataNascimento=birth_date;Genero=gender;EmailCifrado=email_ciphertext;EmailIndice=email_hash;IndicativoCifrado=dial_code_ciphertext;TelefoneCifrado=phone_ciphertext;TelefoneIndice=phone_hash;MoradaCifrada=address_ciphertext;NumeroFilhos=children_count;Relacionamento=relationship_status;Ativa=is_active;CriadaEm=created_at;AtualizadaEm=updated_at;Versao=version";
    private const string AccountsMap = "Id=id;PessoaOrigemId=origin_person_id;Perfil=role;NomePublico=display_name;PasswordHash=password_hash;EmailAcessoIndice=email_login_hash;TelefoneAcessoIndice=phone_login_hash;EmailConfirmadoEm=email_confirmed_at;EstadoVinculo=link_status;VinculoValidadoEm=link_verified_at;VinculoValidadoPorContaId=link_verified_by_account_id;FalhasEntrada=failed_sign_in_count;BloqueadaAte=lockout_end;SeloSeguranca=security_stamp;CriadaEm=created_at;AtualizadaEm=updated_at;EncerradaEm=closed_at;Versao=version";

    public static async Task<IReadOnlyList<PreparedSchemaTable>> PrepareAsync(DatabaseConnectionSettings settings, InstallationPaths paths, CancellationToken ct)
    {
        await using var connection = InitialIdentitySchema.CreatePreparationConnection(settings);
        await connection.OpenAsync(ct);
        if ((string?)await Scalar(connection, "SELECT DATABASE()", ct) != DatabaseConnectionSettings.ExpectedDatabaseName)
            throw new InvalidOperationException("The installation database was not confirmed.");
        if (Convert.ToInt32(await Scalar(connection, "SELECT GET_LOCK('pact0.2_db:installation', 0)", ct)) != 1)
            throw new InvalidOperationException("Another installation preparation is running.");
        try
        {
            var tables = await Names(connection, "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()", ct);
            if (tables.Count == 0) { await InitialIdentitySchema.CreateAsync(settings, ct); }
            else if (tables.Count == 2 && tables.Contains("pessoas") && tables.Contains("contas"))
            {
                foreach (var table in tables)
                    if (Convert.ToInt64(await Scalar(connection, "SELECT COUNT(*) FROM " + Quote(table), ct)) != 0)
                        throw new InvalidOperationException("The language upgrade only supports the verified empty foundation. Existing records require a separately reviewed data migration; nothing was changed.");
                await CheckLegacyColumns(connection, "pessoas", PeopleMap, [], ct);
                await CheckLegacyColumns(connection, "contas", AccountsMap, ["EmailAtivo", "TelefoneAtivo", "GestorPermanente"], ct);
                var definitions = new Dictionary<string, string>();
                foreach (var table in tables)
                {
                    await using var command = new MySqlCommand("SHOW CREATE TABLE " + Quote(table), connection);
                    await using var reader = await command.ExecuteReaderAsync(ct);
                    await reader.ReadAsync(ct);
                    definitions[table] = reader.GetString(1);
                }
                Directory.CreateDirectory(Path.Combine(paths.Root, "schema-backups"));
                var backup = JsonSerializer.Serialize(new { database = DatabaseConnectionSettings.ExpectedDatabaseName, rowCount = 0, definitions });
                var backupPath = Path.Combine(paths.Root, "schema-backups", "empty-foundation-" + DateTime.UtcNow.ToString("yyyyMMddHHmmssfffffff") + ".json");
                await File.WriteAllTextAsync(backupPath, backup, ct);
                var savedBackup = await File.ReadAllBytesAsync(backupPath, ct);
                if (!SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(backup)).SequenceEqual(SHA256.HashData(savedBackup)))
                    throw new InvalidOperationException("The schema backup could not be verified. Nothing was changed.");
                await DropLegacyConstraints(connection, "contas", ct);
                await DropLegacyConstraints(connection, "pessoas", ct);
                await Execute(connection, "ALTER TABLE contas DROP COLUMN EmailAtivo, DROP COLUMN TelefoneAtivo, DROP COLUMN GestorPermanente", ct);
                await Execute(connection, "RENAME TABLE pessoas TO people, contas TO accounts", ct);
                await RenameColumns(connection, "people", PeopleMap, ct);
                await RenameColumns(connection, "accounts", AccountsMap, ct);
                await AddDefinitions(connection, "people", InitialIdentitySchema.PeopleSql, PeopleMap, ct);
                await AddDefinitions(connection, "accounts", InitialIdentitySchema.AccountsSql, AccountsMap, ct);
                await Execute(connection, InitialIdentitySchema.SecurityEmailsSql, ct);
            }
            return await VerifyAsync(connection, ct);
        }
        finally { await Scalar(connection, "SELECT RELEASE_LOCK('pact0.2_db:installation')", CancellationToken.None); }
    }

    private static string Quote(string value) => "`" + value.Replace("`", "``", StringComparison.Ordinal) + "`";
    private static IEnumerable<string> Lines(string sql) => sql.Split('\n').Select(line => line.Trim().TrimEnd(','));
    private static string[] Columns(string sql) => Lines(sql).Where(line => line.StartsWith('`')).Select(line => line.Split('`')[1]).ToArray();
    private static string[] OldColumns(string map) => map.Split(';').Select(pair => pair.Split('=')[0]).ToArray();

    private static async Task CheckLegacyColumns(MySqlConnection connection, string table, string map, string[] generated, CancellationToken ct)
    {
        var actual = await Names(connection, "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='" + table + "' ORDER BY ORDINAL_POSITION", ct);
        if (!actual.SequenceEqual(OldColumns(map).Concat(generated), StringComparer.Ordinal))
            throw new InvalidOperationException("Unexpected legacy structure. No automatic data conversion is permitted.");
    }

    private static async Task DropLegacyConstraints(MySqlConnection connection, string table, CancellationToken ct)
    {
        var clauses = new List<string>();
        await using (var command = new MySqlCommand("SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=@table AND CONSTRAINT_TYPE IN ('FOREIGN KEY','CHECK')", connection))
        {
            command.Parameters.AddWithValue("@table", table);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) clauses.Add((reader.GetString(1) == "CHECK" ? "DROP CHECK " : "DROP FOREIGN KEY ") + Quote(reader.GetString(0)));
        }
        var indexes = await Names(connection, "SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='" + table + "' AND INDEX_NAME <> 'PRIMARY'", ct);
        clauses.AddRange(indexes.Select(index => "DROP INDEX " + Quote(index)));
        if (clauses.Count > 0) await Execute(connection, "ALTER TABLE " + Quote(table) + " " + string.Join(", ", clauses), ct);
    }

    private static Task RenameColumns(MySqlConnection connection, string table, string map, CancellationToken ct) => Execute(connection,
        "ALTER TABLE " + Quote(table) + " " + string.Join(", ", map.Split(';').Select(pair => { var names = pair.Split('='); return "RENAME COLUMN " + Quote(names[0]) + " TO " + Quote(names[1]); })), ct);

    private static Task AddDefinitions(MySqlConnection connection, string table, string sql, string map, CancellationToken ct)
    {
        var renamed = map.Split(';').Select(pair => pair.Split('=')[1]).ToHashSet(StringComparer.Ordinal);
        var clauses = Lines(sql).Where(line => line.StartsWith("KEY ", StringComparison.Ordinal) || line.StartsWith("UNIQUE KEY ", StringComparison.Ordinal)
            || line.StartsWith("CONSTRAINT ", StringComparison.Ordinal) || (line.StartsWith('`') && !renamed.Contains(line.Split('`')[1])))
            .Select(line => (line.StartsWith('`') ? "ADD COLUMN " : "ADD ") + line);
        return Execute(connection, "ALTER TABLE " + Quote(table) + " " + string.Join(", ", clauses), ct);
    }

    private static async Task<IReadOnlyList<PreparedSchemaTable>> VerifyAsync(MySqlConnection connection, CancellationToken ct)
    {
        var tables = await Names(connection, "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()", ct);
        var expected = new[] { "accounts", "people", "security_emails" };
        if (tables.Contains("therapist_invitations")) expected = [.. expected, "therapist_invitations"];
        if (tables.Contains("client_notes") && tables.Contains("client_reviews")) expected = [.. expected, "client_notes", "client_reviews"];
        if (!tables.Order(StringComparer.Ordinal).SequenceEqual(expected.Order(StringComparer.Ordinal), StringComparer.Ordinal))
            throw new InvalidOperationException("Unexpected tables. Preparation was not confirmed; no fallback deletion was attempted.");
        var result = new List<PreparedSchemaTable>();
        foreach (var sql in InitialIdentitySchema.Statements)
        {
            var table = sql.Split('`')[1];
            var columns = await Names(connection, "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='" + table + "' ORDER BY ORDINAL_POSITION", ct);
            var expectedColumns = table == "people" && tables.Contains("client_reviews") ? Columns(sql).Append("postal_code_ciphertext") : Columns(sql).AsEnumerable();
            if (!columns.SequenceEqual(expectedColumns, StringComparer.Ordinal)) throw new InvalidOperationException("Unexpected columns. Review the schema before continuing.");
            var count = Convert.ToInt64(await Scalar(connection, "SELECT COUNT(*) FROM " + Quote(table), ct));
            result.Add(new(table, count));
        }
        if (tables.Contains("therapist_invitations")) result.Add(await TherapistInvitationSchema.VerifyAsync(connection, ct));
        if (tables.Contains("client_reviews"))
        {
            await ClientSchema.VerifyAsync(connection, ct);
            foreach (var table in new[] { "client_notes", "client_reviews" })
                result.Add(new(table, Convert.ToInt64(await Scalar(connection, "SELECT COUNT(*) FROM " + Quote(table), ct))));
        }
        return result.AsReadOnly();
    }

    private static async Task<object?> Scalar(MySqlConnection connection, string sql, CancellationToken ct)
    { await using var command = new MySqlCommand(sql, connection); return await command.ExecuteScalarAsync(ct); }
    private static async Task Execute(MySqlConnection connection, string sql, CancellationToken ct)
    { await using var command = new MySqlCommand(sql, connection); await command.ExecuteNonQueryAsync(ct); }
    private static async Task<List<string>> Names(MySqlConnection connection, string sql, CancellationToken ct)
    {
        await using var command = new MySqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync(ct);
        var result = new List<string>();
        while (await reader.ReadAsync(ct)) result.Add(reader.GetString(0));
        return result;
    }
}
