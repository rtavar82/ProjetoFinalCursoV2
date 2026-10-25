using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;

namespace PaCT.Api.Identity;

public sealed class MySqlClientAccessStore(DatabaseConnectionSettings settings) : IClientAccessStore
{
    internal static IClientAccessSession InTransaction(MySqlConnection connection, MySqlTransaction transaction, CancellationToken ct) => new Session(connection, transaction, ct);
    public async Task<T> ExecuteAsync<T>(Func<IClientAccessSession, Task<T>> action, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        await using var gate = new MySqlCommand("SELECT GET_LOCK('pact0.2_db:client-writes',5)", connection);
        if (Convert.ToInt32(await gate.ExecuteScalarAsync(ct)) != 1) throw new IdentityProblem(409, "Há outra alteração em curso. Volta a tentar dentro de instantes.");
        try
        {
            await using var transaction = await connection.BeginTransactionAsync(ct);
            var result = await action(new Session(connection, transaction, ct));
            await transaction.CommitAsync(ct);
            return result;
        }
        catch (MySqlException error) when (error.Number == 1062) { throw new IdentityProblem(409, "Os dados mudaram entretanto. Atualiza e verifica o pedido."); }
        catch (MySqlException error) when (error.Number == 1146) { throw new IdentityProblem(503, "A gestão de acesso ainda não está preparada nesta instalação."); }
        finally
        {
            await using var release = new MySqlCommand("SELECT RELEASE_LOCK('pact0.2_db:client-writes')", connection);
            await release.ExecuteScalarAsync(CancellationToken.None);
        }
    }

    private sealed class Session(MySqlConnection connection, MySqlTransaction transaction, CancellationToken ct) : IClientAccessSession
    {
        private MySqlCommand Command(string sql, params (string Key, object? Value)[] values)
        {
            var command = new MySqlCommand(sql, connection, transaction);
            foreach (var (key, value) in values) command.Parameters.AddWithValue(key, value ?? DBNull.Value);
            return command;
        }
        public async Task<IdentityAccount?> AccountAsync(string id, bool byPerson = false)
        {
            await using var command = Command("SELECT a.*,p.email_ciphertext,p.is_active FROM accounts a JOIN people p ON p.id=a.origin_person_id WHERE "
                + (byPerson ? "a.origin_person_id" : "a.id") + "=@id FOR UPDATE", ("@id", id));
            await using var reader = await command.ExecuteReaderAsync(ct);
            return await reader.ReadAsync(ct) ? MySqlIdentityStore.ReadAccount(reader) : null;
        }
        private static ClientAccessAction Read(MySqlDataReader r) => new(r.GetGuid("id").ToString("D"), r.GetGuid("account_id").ToString("D"),
            r.GetGuid("person_id").ToString("D"), r.GetGuid("created_by_account_id").ToString("D"), r.GetString("kind"), r.GetString("status"),
            r.GetGuid("security_stamp").ToString("D"), (byte[])r["previous_email_hash"], r["email_hash"] as byte[], (byte[])r["details_ciphertext"],
            r.GetDateTime("created_at"), r.GetDateTime("expires_at"), r["completed_at"] is DBNull ? null : r.GetDateTime("completed_at"));
        public async Task<ClientAccessAction?> ActionAsync(string id)
        {
            await using var command = Command("SELECT * FROM account_security_actions WHERE id=@id FOR UPDATE", ("@id", id));
            await using var reader = (MySqlDataReader)await command.ExecuteReaderAsync(ct);
            return await reader.ReadAsync(ct) ? Read(reader) : null;
        }
        public async Task<IReadOnlyList<ClientAccessAction>> ActionsAsync(string accountId)
        {
            await using var command = Command("SELECT * FROM account_security_actions WHERE account_id=@id ORDER BY created_at DESC,id DESC", ("@id", accountId));
            await using var reader = (MySqlDataReader)await command.ExecuteReaderAsync(ct);
            var result = new List<ClientAccessAction>();
            while (await reader.ReadAsync(ct)) result.Add(Read(reader));
            return result;
        }
        public async Task<int> PasskeyCountAsync(string accountId)
        {
            await using var command = Command("SELECT COUNT(*) FROM account_passkeys WHERE account_id=@id", ("@id", accountId));
            return Convert.ToInt32(await command.ExecuteScalarAsync(ct));
        }
        public async Task<bool> EmailUsedAsync(byte[] hash, string personId)
        {
            await using var command = Command("""
                SELECT EXISTS(SELECT 1 FROM people WHERE id<>@person AND is_active=1 AND email_hash=@hash)
                    OR EXISTS(SELECT 1 FROM accounts WHERE origin_person_id<>@person AND closed_at IS NULL AND email_login_hash=@hash)
                """, ("@person", personId), ("@hash", hash));
            return Convert.ToBoolean(await command.ExecuteScalarAsync(ct));
        }
        public async Task SaveActionAsync(ClientAccessAction action, bool create)
        {
            await using var command = create ? Command("""
                INSERT INTO account_security_actions
                  (id,account_id,person_id,created_by_account_id,kind,status,security_stamp,previous_email_hash,email_hash,details_ciphertext,created_at,expires_at,completed_at)
                VALUES (@id,@account,@person,@actor,@kind,@status,@stamp,@previous,@hash,@details,@created,@expires,@completed)
                """, ("@id", action.Id), ("@account", action.AccountId), ("@person", action.PersonId), ("@actor", action.CreatedByAccountId),
                ("@kind", action.Kind), ("@status", action.Status), ("@stamp", action.SecurityStamp), ("@previous", action.PreviousEmailHash),
                ("@hash", action.EmailHash), ("@details", action.Details), ("@created", action.CreatedAt), ("@expires", action.ExpiresAt), ("@completed", action.CompletedAt))
                : Command("UPDATE account_security_actions SET status=@status,completed_at=@completed WHERE id=@id AND status='Pending'",
                    ("@status", action.Status), ("@completed", action.CompletedAt), ("@id", action.Id));
            if (await command.ExecuteNonQueryAsync(ct) != 1) throw new IdentityProblem(409, "Este pedido já foi tratado. Atualiza a informação.");
        }
        public Task QueueEmailAsync(EmailJob job) => MySqlIdentityStore.InsertEmailAsync(connection, transaction, job, ct);
        public async Task ChangeEmailAsync(IdentityAccount account, byte[] ciphertext, byte[] hash, DateTime now)
        {
            await using (var command = Command("""
                UPDATE accounts SET email_login_hash=@hash,email_confirmed_at=@now,security_stamp=UUID(),
                  updated_at=GREATEST(created_at,@now),version=version+1
                WHERE id=@id AND version=@version AND security_stamp=@stamp AND role='Client' AND closed_at IS NULL
                """, ("@hash", hash), ("@now", now), ("@id", account.Id), ("@version", account.Version), ("@stamp", account.SecurityStamp)))
                if (await command.ExecuteNonQueryAsync(ct) != 1) throw new IdentityProblem(409, "A conta mudou entretanto. Pede um novo envio.");
            await using (var command = Command("""
                UPDATE people SET email_ciphertext=@email,email_hash=@hash,updated_at=GREATEST(created_at,@now),version=version+1
                WHERE id=@id AND is_active=1
                """, ("@email", ciphertext), ("@hash", hash), ("@now", now), ("@id", account.PersonId)))
                if (await command.ExecuteNonQueryAsync(ct) != 1) throw new IdentityProblem(409, "A ficha mudou entretanto. Contacta a gestão.");
            await RevokePushAsync(account.Id);
        }
        public async Task ResetPasskeysAsync(IdentityAccount account, DateTime now)
        {
            await using (var command = Command("""
                UPDATE accounts SET passkey_enabled_at=NULL,authenticator_secret=NULL,two_factor_enabled_at=NULL,
                  last_totp_step=NULL,recovery_code_hashes=NULL,security_stamp=UUID(),updated_at=GREATEST(created_at,@now),version=version+1
                WHERE id=@id AND version=@version AND security_stamp=@stamp AND role='Client' AND closed_at IS NULL
                """, ("@now", now), ("@id", account.Id), ("@version", account.Version), ("@stamp", account.SecurityStamp)))
                if (await command.ExecuteNonQueryAsync(ct) != 1) throw new IdentityProblem(409, "A conta mudou entretanto. Atualiza a informação.");
            await using (var command = Command("DELETE FROM account_passkeys WHERE account_id=@id", ("@id", account.Id)))
                await command.ExecuteNonQueryAsync(ct);
            await RevokePushAsync(account.Id);
        }
        public async Task ChangePasswordAsync(IdentityAccount account, string hash, DateTime now)
        {
            await using var command = Command("""
                UPDATE accounts SET password_hash=@hash,password_sign_in_required=1,security_stamp=UUID(),
                  failed_sign_in_count=0,lockout_end=NULL,updated_at=GREATEST(created_at,@now),version=version+1
                WHERE id=@id AND version=@version AND security_stamp=@stamp AND closed_at IS NULL
                """, ("@hash", hash), ("@now", now), ("@id", account.Id), ("@version", account.Version), ("@stamp", account.SecurityStamp));
            if (await command.ExecuteNonQueryAsync(ct) != 1) throw new IdentityProblem(409, "A conta mudou entretanto. Pede um novo email para alterar a palavra-passe.");
            await RevokePushAsync(account.Id);
        }
        private static GoogleAccountLink ReadGoogle(MySqlDataReader r) => new(r.GetGuid("id").ToString("D"), r.GetGuid("account_id").ToString("D"),
            (byte[])r["subject_hash"], (byte[])r["identity_ciphertext"], r.GetDateTime("created_at"));
        private async Task<GoogleAccountLink?> ReadGoogleAsync(string predicate, object value)
        {
            await using var command = Command("SELECT * FROM account_external_logins WHERE provider='Google' AND " + predicate + "=@value FOR UPDATE", ("@value", value));
            await using var reader = (MySqlDataReader)await command.ExecuteReaderAsync(ct);
            return await reader.ReadAsync(ct) ? ReadGoogle(reader) : null;
        }
        public Task<GoogleAccountLink?> GoogleLinkAsync(string accountId) => ReadGoogleAsync("account_id", accountId);
        public Task<GoogleAccountLink?> GoogleSubjectAsync(byte[] subjectHash) => ReadGoogleAsync("subject_hash", subjectHash);
        public async Task AddGoogleLinkAsync(GoogleAccountLink link)
        {
            await using var command = Command("""
                INSERT INTO account_external_logins (id,account_id,provider,subject_hash,identity_ciphertext,created_at)
                VALUES (@id,@account,'Google',@subject,@identity,@now)
                """, ("@id", link.Id), ("@account", link.AccountId), ("@subject", link.SubjectHash), ("@identity", link.IdentityCiphertext), ("@now", link.CreatedAt));
            await command.ExecuteNonQueryAsync(ct);
        }
        public async Task RemoveGoogleLinkAsync(IdentityAccount account, DateTime now)
        {
            await using (var command = Command("DELETE FROM account_external_logins WHERE account_id=@id AND provider='Google'", ("@id", account.Id)))
                if (await command.ExecuteNonQueryAsync(ct) != 1) throw new IdentityProblem(409, "A ligação ao Google já foi alterada.");
            await using (var command = Command("UPDATE accounts SET security_stamp=UUID(),version=version+1,updated_at=GREATEST(created_at,@now) WHERE id=@id AND version=@version AND security_stamp=@stamp AND closed_at IS NULL",
                ("@id", account.Id), ("@version", account.Version), ("@stamp", account.SecurityStamp), ("@now", now)))
                if (await command.ExecuteNonQueryAsync(ct) != 1) throw new IdentityProblem(409, "A conta mudou entretanto. Atualiza e volta a tentar.");
            await RevokePushAsync(account.Id);
        }
        private async Task RevokePushAsync(string accountId)
        {
            await using var exists = Command("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='push_subscriptions'");
            if (Convert.ToInt32(await exists.ExecuteScalarAsync(ct)) == 0) return;
            await using var command = Command("DELETE FROM push_subscriptions WHERE account_id=@id", ("@id", accountId));
            await command.ExecuteNonQueryAsync(ct);
        }
    }
}
