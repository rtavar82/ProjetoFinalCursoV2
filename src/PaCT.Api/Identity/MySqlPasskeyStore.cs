using System.Text.Json;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;

namespace PaCT.Api.Identity;

public sealed class MySqlPasskeyStore(DatabaseConnectionSettings settings) : IPasskeyStore
{
    private async Task<MySqlConnection> Open(CancellationToken ct) { var c = settings.CreateConnection(); try { await c.OpenAsync(ct); return c; } catch { await c.DisposeAsync(); throw; } }
    private static MySqlCommand Command(MySqlConnection c, string sql, MySqlTransaction? tx = null, params (string, object?)[] values)
    { var command = new MySqlCommand(sql, c, tx); foreach (var (key, value) in values) command.Parameters.AddWithValue(key, value ?? DBNull.Value); return command; }
    private static AccountPasskey Read(MySqlDataReader r) => new((byte[])r["id"], r.GetGuid("account_id").ToString("D"), (byte[])r["public_key"], r.GetUInt32("sign_count"),
        JsonSerializer.Deserialize<string[]>(r.GetString("transports")) ?? [], r.GetBoolean("backup_eligible"), r.GetBoolean("backed_up"), r.GetString("name"), r.GetDateTime("created_at"), r.IsDBNull(r.GetOrdinal("last_used_at")) ? null : r.GetDateTime("last_used_at"));
    public async Task<IReadOnlyList<AccountPasskey>> ListAsync(string id, CancellationToken ct)
    {
        await using var c = await Open(ct); await using var cmd = Command(c, "SELECT * FROM account_passkeys WHERE account_id=@id ORDER BY created_at,id", null, ("@id", id));
        await using var reader = (MySqlDataReader)await cmd.ExecuteReaderAsync(ct); var list = new List<AccountPasskey>(); while (await reader.ReadAsync(ct)) list.Add(Read(reader)); return list;
    }
    public async Task<AccountPasskey?> FindCredentialAsync(byte[] id, CancellationToken ct)
    {
        await using var c = await Open(ct); await using var cmd = Command(c, "SELECT * FROM account_passkeys WHERE id=@id", null, ("@id", id));
        await using var reader = (MySqlDataReader)await cmd.ExecuteReaderAsync(ct); return await reader.ReadAsync(ct) ? Read(reader) : null;
    }
    private static async Task Guard(MySqlConnection c, MySqlTransaction tx, IdentityAccount account, CancellationToken ct)
    {
        await using var cmd = Command(c, "SELECT a.id FROM accounts a JOIN people p ON p.id=a.origin_person_id WHERE a.id=@id AND a.security_stamp=@stamp AND a.version=@version AND a.closed_at IS NULL AND p.is_active=1 AND a.link_status='Verified' AND a.email_confirmed_at IS NOT NULL AND a.password_hash IS NOT NULL FOR UPDATE", tx,
            ("@id", account.Id), ("@stamp", account.SecurityStamp), ("@version", account.Version));
        if (await cmd.ExecuteScalarAsync(ct) is null) throw new IdentityProblem(409, "A conta mudou. Inicia sessão novamente.");
    }
    public async Task RegisterAsync(IdentityAccount account, AccountPasskey key, DateTime now, CancellationToken ct)
    {
        await using var c = await Open(ct); await using var tx = await c.BeginTransactionAsync(ct); await Guard(c, tx, account, ct);
        await using (var count = Command(c, "SELECT COUNT(*) FROM account_passkeys WHERE account_id=@id", tx, ("@id", account.Id)))
            if (Convert.ToInt32(await count.ExecuteScalarAsync(ct)) >= 10) throw new IdentityProblem(409, "Limite de dez Passkeys atingido.");
        try
        {
            await using var insert = Command(c, "INSERT INTO account_passkeys (id,account_id,public_key,sign_count,transports,backup_eligible,backed_up,name,created_at) VALUES (@id,@account,@key,@count,@transports,@eligible,@backed,@name,@now)", tx,
                ("@id", key.Id), ("@account", account.Id), ("@key", key.PublicKey), ("@count", key.SignCount), ("@transports", JsonSerializer.Serialize(key.Transports)), ("@eligible", key.BackupEligible), ("@backed", key.BackedUp), ("@name", key.Name), ("@now", now));
            await insert.ExecuteNonQueryAsync(ct);
            await using var update = Command(c, "UPDATE accounts SET passkey_enabled_at=COALESCE(passkey_enabled_at,@now),failed_sign_in_count=0,lockout_end=NULL,updated_at=GREATEST(created_at,@now),version=version+1 WHERE id=@id", tx, ("@now", now), ("@id", account.Id));
            await update.ExecuteNonQueryAsync(ct); await tx.CommitAsync(ct);
        }
        catch (MySqlException error) when (error.Number == 1062) { throw new IdentityProblem(409, "Esta Passkey já está registada. Nenhuma credencial foi substituída."); }
    }
    public async Task UseAsync(IdentityAccount account, AccountPasskey key, uint count, bool backedUp, DateTime now, CancellationToken ct)
    {
        await using var c = await Open(ct); await using var tx = await c.BeginTransactionAsync(ct); await Guard(c, tx, account, ct);
        await using var update = Command(c, "UPDATE account_passkeys SET sign_count=@count,backed_up=@backed,last_used_at=@now WHERE id=@id AND account_id=@account AND sign_count=@previous", tx,
            ("@count", count), ("@backed", backedUp), ("@now", now), ("@id", key.Id), ("@account", account.Id), ("@previous", key.SignCount));
        if (await update.ExecuteNonQueryAsync(ct) != 1) throw new IdentityProblem(409, "A Passkey foi utilizada noutra verificação. Inicia uma nova tentativa.");
        await using var reset = Command(c, "UPDATE accounts SET failed_sign_in_count=0,lockout_end=NULL,updated_at=GREATEST(created_at,@now),version=version+1 WHERE id=@id", tx, ("@now", now), ("@id", account.Id));
        await reset.ExecuteNonQueryAsync(ct); await tx.CommitAsync(ct);
    }
}
