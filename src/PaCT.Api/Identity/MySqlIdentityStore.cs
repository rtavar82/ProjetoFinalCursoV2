using System.Data.Common;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;

namespace PaCT.Api.Identity;

public sealed partial class MySqlIdentityStore(DatabaseConnectionSettings settings, TimeProvider? time = null) : IIdentityStore
{
    private const string SelectAccount = """
        SELECT a.*, p.email_ciphertext, p.is_active FROM accounts a
        JOIN people p ON p.id = a.origin_person_id
        """;

    private static MySqlCommand Command(MySqlConnection connection, string sql, MySqlTransaction? transaction = null,
        params (string Name, object? Value)[] values)
    {
        var command = new MySqlCommand(sql, connection, transaction);
        foreach (var (name, value) in values) command.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return command;
    }

    private async Task<MySqlConnection> OpenAsync(CancellationToken ct)
    {
        var connection = settings.CreateConnection();
        try { await connection.OpenAsync(ct); return connection; }
        catch { await connection.DisposeAsync(); throw; }
    }

    public async Task<bool> HasTechnicalManagerAsync(CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var command = Command(connection, "SELECT EXISTS(SELECT 1 FROM accounts WHERE role = 'TechnicalManager')");
        return Convert.ToBoolean(await command.ExecuteScalarAsync(ct));
    }

    public Task<IdentityAccount?> FindAsync(string id, CancellationToken ct) =>
        FindAccountAsync("a.id = @value", id, ct);
    public Task<IdentityAccount?> FindByEmailAsync(byte[] hash, CancellationToken ct) =>
        FindAccountAsync("a.active_email_hash = @value", hash, ct);

    private async Task<IdentityAccount?> FindAccountAsync(string predicate, object value, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var command = Command(connection, SelectAccount + " WHERE " + predicate, null, ("@value", value));
        await using var reader = (MySqlDataReader)await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        return ReadAccount(reader);
    }

    internal static IdentityAccount ReadAccount(DbDataReader reader) =>
        new()
        {
            Id = Identifier(reader, "id"), PersonId = Identifier(reader, "origin_person_id"), Role = reader.GetString(reader.GetOrdinal("role")),
            DisplayName = reader.GetString(reader.GetOrdinal("display_name")), PasswordHash = reader["password_hash"] as string,
            SecurityStamp = reader.GetString(reader.GetOrdinal("security_stamp")), EmailHash = (byte[])reader["email_login_hash"],
            EmailCiphertext = (byte[])reader["email_ciphertext"], CreatedAt = reader.GetDateTime(reader.GetOrdinal("created_at")),
            PersonActive = Convert.ToBoolean(reader["is_active"]), LinkStatus = reader.GetString(reader.GetOrdinal("link_status")),
            EmailConfirmedAt = Date(reader, "email_confirmed_at"), TwoFactorEnabledAt = Date(reader, "two_factor_enabled_at"),
            PasskeyEnabledAt = reader.GetColumnSchema().Any(c => c.ColumnName == "passkey_enabled_at") ? Date(reader, "passkey_enabled_at") : null,
            PasswordSignInRequired = reader.GetColumnSchema().Any(c => c.ColumnName == "password_sign_in_required") && Convert.ToBoolean(reader["password_sign_in_required"]),
            AuthenticatorSecret = reader["authenticator_secret"] as byte[], LastTotpStep = reader.IsDBNull(reader.GetOrdinal("last_totp_step")) ? null : reader.GetInt64(reader.GetOrdinal("last_totp_step")),
            RecoveryCodeHashes = reader["recovery_code_hashes"] as string ?? "[]", FailedSignInCount = reader.GetInt32(reader.GetOrdinal("failed_sign_in_count")),
            LockoutEnd = Date(reader, "lockout_end"), ClosedAt = Date(reader, "closed_at"), Version = Convert.ToUInt64(reader["version"])
        };

    // Connector/NET exposes CHAR(36) identifiers as Guid, not String.
    private static string Identifier(DbDataReader reader, string name) => reader.GetGuid(reader.GetOrdinal(name)).ToString("D");

    internal static EmailJob ReadEmail(DbDataReader reader) => new(Identifier(reader, "id"), Identifier(reader, "account_id"),
        (byte[])reader["payload_ciphertext"], "Pending", reader.GetDateTime(reader.GetOrdinal("created_at")));

    private static DateTime? Date(DbDataReader reader, string name) => reader.IsDBNull(reader.GetOrdinal(name)) ? null : reader.GetDateTime(reader.GetOrdinal(name));

    public async Task CreateAsync(PrivatePerson person, IdentityAccount account, EmailJob email, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        try
        {
            await InsertIdentityAsync(connection, transaction, person, account, email, ct);
            await transaction.CommitAsync(ct);
        }
        catch (MySqlException error) when (error.Number == 1062)
        {
            throw new IdentityProblem(409, "A instalação já tem gestor técnico ou existe um conflito com os dados indicados. Não foi criada outra conta.");
        }
    }

    internal static async Task InsertIdentityAsync(MySqlConnection connection, MySqlTransaction transaction,
        PrivatePerson person, IdentityAccount account, EmailJob email, CancellationToken ct)
    {
        await using (var command = Command(connection, """
                INSERT INTO people (id, first_name_ciphertext, last_name_ciphertext, locality, email_ciphertext, email_hash, created_at, updated_at)
                VALUES (@id, @first, @last, @locality, @email, @hash, @now, @now)
                """, transaction, ("@id", person.Id), ("@first", person.FirstName), ("@last", person.LastName),
                ("@locality", person.Locality), ("@email", person.Email), ("@hash", person.EmailHash), ("@now", person.CreatedAt)))
                await command.ExecuteNonQueryAsync(ct);
            await using (var command = Command(connection, """
                INSERT INTO accounts (id, origin_person_id, role, display_name, password_hash, email_login_hash,
                  link_status, link_verified_at, security_stamp, created_at, updated_at)
                VALUES (@id, @person, @role, @name, @password, @email, 'Verified', @now, @stamp, @now, @now)
                """, transaction, ("@id", account.Id), ("@person", person.Id), ("@role", account.Role),
                ("@name", account.DisplayName), ("@password", account.PasswordHash), ("@email", account.EmailHash),
                ("@stamp", account.SecurityStamp), ("@now", account.CreatedAt)))
                await command.ExecuteNonQueryAsync(ct);
            await InsertEmailAsync(connection, transaction, email, ct);
    }

    public async Task<bool> UpdateAsync(IdentityAccount account, DateTime now, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var command = Command(connection, """
            UPDATE accounts SET password_hash=@password, security_stamp=@stamp, email_confirmed_at=@confirmed,
              authenticator_secret=@secret, two_factor_enabled_at=@enabled, last_totp_step=@step,
              recovery_code_hashes=@recovery, failed_sign_in_count=@failures, lockout_end=@locked,
              closed_at=@closed, password_sign_in_required=@passwordRequired, updated_at=@now, version=version+1
            WHERE id=@id AND version=@version AND closed_at IS NULL
            """, null, ("@password", account.PasswordHash), ("@stamp", account.SecurityStamp),
            ("@confirmed", account.EmailConfirmedAt), ("@secret", account.AuthenticatorSecret), ("@enabled", account.TwoFactorEnabledAt),
            ("@step", account.LastTotpStep), ("@recovery", account.RecoveryCodeHashes), ("@failures", account.FailedSignInCount),
            ("@locked", account.LockoutEnd), ("@closed", account.ClosedAt), ("@passwordRequired", account.PasswordSignInRequired), ("@now", now), ("@id", account.Id), ("@version", account.Version));
        return await command.ExecuteNonQueryAsync(ct) == 1;
    }

    internal static async Task InsertEmailAsync(MySqlConnection connection, MySqlTransaction transaction, EmailJob email, CancellationToken ct)
    {
        await using var command = Command(connection, """
            INSERT INTO security_emails (id, account_id, payload_ciphertext, state, created_at, updated_at)
            VALUES (@id, @account, @payload, 'Pending', @now, @now)
            """, transaction, ("@id", email.Id), ("@account", email.AccountId), ("@payload", email.Payload), ("@now", email.CreatedAt));
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task QueueConfirmationAsync(EmailJob email, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await using var gate = Command(connection, "SELECT id FROM accounts WHERE id=@id AND email_confirmed_at IS NULL AND closed_at IS NULL FOR UPDATE", transaction, ("@id", email.AccountId));
        if (await gate.ExecuteScalarAsync(ct) is null) throw new IdentityProblem(409, "A confirmação já não é necessária.");
        await using var revision = Command(connection, "UPDATE accounts SET version=version+1, updated_at=@now WHERE id=@id", transaction, ("@id", email.AccountId), ("@now", email.CreatedAt));
        await revision.ExecuteNonQueryAsync(ct);
        await using var cancel = Command(connection, "UPDATE security_emails SET state='Cancelled', updated_at=@now WHERE account_id=@id", transaction, ("@id", email.AccountId), ("@now", email.CreatedAt));
        await cancel.ExecuteNonQueryAsync(ct);
        await InsertEmailAsync(connection, transaction, email, ct);
        await transaction.CommitAsync(ct);
    }

    public async Task<bool> IsConfirmationCurrentAsync(string emailId, string accountId, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var command = Command(connection, "SELECT EXISTS(SELECT 1 FROM security_emails WHERE id=@id AND account_id=@account AND state <> 'Cancelled')", null, ("@id", emailId), ("@account", accountId));
        return Convert.ToBoolean(await command.ExecuteScalarAsync(ct));
    }

    public async Task<EmailJob?> ClaimEmailAsync(DateTime now, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        EmailJob? job;
        await using (var command = Command(connection, "SELECT * FROM security_emails WHERE state='Pending' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED", transaction))
        await using (var reader = (MySqlDataReader)await command.ExecuteReaderAsync(ct))
        {
            job = await reader.ReadAsync(ct) ? ReadEmail(reader) : null;
        }
        if (job is null) return null;
        await using var update = Command(connection, "UPDATE security_emails SET state='Sending', attempted_at=@now, updated_at=@now WHERE id=@id AND state='Pending'", transaction, ("@id", job.Id), ("@now", now));
        await update.ExecuteNonQueryAsync(ct);
        await transaction.CommitAsync(ct);
        return job;
    }

    public async Task<string?> LatestEmailStateAsync(string accountId, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var command = Command(connection, "SELECT state FROM security_emails WHERE account_id=@id ORDER BY created_at DESC, id DESC LIMIT 1", null, ("@id", accountId));
        return await command.ExecuteScalarAsync(ct) as string;
    }

    public async Task<string?> EmailStateAsync(string id, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var command = Command(connection, "SELECT state FROM security_emails WHERE id=@id", null, ("@id", id));
        return await command.ExecuteScalarAsync(ct) as string;
    }

    public async Task CompleteEmailAsync(string id, string state, DateTime now, CancellationToken ct)
    {
        if (state is not ("Submitted" or "Failed" or "Uncertain" or "Cancelled")) throw new ArgumentOutOfRangeException(nameof(state));
        await using var connection = await OpenAsync(ct);
        await using var command = Command(connection, "UPDATE security_emails SET state=@state, updated_at=@now WHERE id=@id AND state='Sending'", null, ("@state", state), ("@id", id), ("@now", now));
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task RecoverInterruptedEmailsAsync(DateTime now, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var command = Command(connection, "UPDATE security_emails SET state='Uncertain', updated_at=@now WHERE state='Sending' AND attempted_at < @cutoff", null, ("@now", now), ("@cutoff", now.AddMinutes(-2)));
        await command.ExecuteNonQueryAsync(ct);
    }
}
