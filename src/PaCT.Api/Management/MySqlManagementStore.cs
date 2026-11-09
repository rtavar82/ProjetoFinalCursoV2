using System.Data;
using System.Text.Json;
using MySql.Data.MySqlClient;
using PaCT.Api.Clients;
using PaCT.Api.Configuration;
using PaCT.Api.Infrastructure;
using PaCT.Api.Identity;

namespace PaCT.Api.Management;

public sealed class MySqlManagementStore(DatabaseConnectionSettings settings, IdentitySecurity security, TimeProvider time) : IManagementStore
{
    internal static MySqlCommand Query(MySqlConnection connection, MySqlTransaction? transaction, string sql, params (string, object?)[] values)
    {
        var command = new MySqlCommand(sql, connection, transaction);
        foreach (var (name, value) in values) command.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return command;
    }
    internal static async Task Ready(MySqlConnection connection, MySqlTransaction? transaction, CancellationToken ct)
    {
        await using var query = Query(connection, transaction, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('management_entries','management_entry_history','client_commands')");
        if (Convert.ToInt32(await query.ExecuteScalarAsync(ct)) != 3)
            throw new IdentityProblem(503, "A preparação da Gestão da aplicação ainda não foi concluída.");
    }
    private DirectoryEntry Decode(string id, byte[] data) => JsonSerializer.Deserialize<DirectoryEntry>(security.Decrypt(id, "management-entry", data))!;
    public async Task<DirectoryPage> ListAsync(string kind, string? term, string status, int page, CancellationToken ct)
    {
        ManagementDirectory.Filters(kind, term, status, page);
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct); await Ready(connection, null, ct);
        var rows = new List<DirectoryEntry>();
        await using var query = Query(connection, null, "SELECT id,data FROM management_entries WHERE kind=@kind AND (@all OR active=@active)", ("@kind", kind), ("@all", status == "All"), ("@active", status == "Active"));
        await using var reader = await query.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) rows.Add(Decode(reader.GetGuid(0).ToString("D"), (byte[])reader[1]));
        return ManagementDirectory.Page(rows, kind, term, status, page);
    }
    public async Task<DirectoryDetail> DetailAsync(string kind, string id, int historyPage, CancellationToken ct)
    {
        ManagementDirectory.Filters(kind, null, "All", historyPage);
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct); await Ready(connection, transaction, ct);
        var entry = await ReadEntry(connection, transaction, kind, id, security, ct);
        int total;
        await using (var count = Query(connection, transaction, "SELECT COUNT(*) FROM management_entry_history WHERE entry_id=@id AND kind=@kind", ("@id", id), ("@kind", kind)))
            total = Convert.ToInt32(await count.ExecuteScalarAsync(ct));
        var history = new List<DirectoryHistory>();
        await using (var query = Query(connection, transaction, "SELECT action,data FROM management_entry_history WHERE entry_id=@id AND kind=@kind ORDER BY version DESC LIMIT 8 OFFSET @skip", ("@id", id), ("@kind", kind), ("@skip", (historyPage - 1) * 8)))
        await using (var reader = await query.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) history.Add(new(reader.GetString(0), Decode(id, (byte[])reader[1])));
        if (entry is null) throw new IdentityProblem(404, "Registo não encontrado. Pode ter sido eliminado.");
        await transaction.CommitAsync(ct); return new(entry, total, historyPage, history.ToArray());
    }
    internal static async Task<DirectoryEntry?> ReadEntry(MySqlConnection connection, MySqlTransaction transaction, string kind, string id, IdentitySecurity security, CancellationToken ct)
    {
        await using var query = Query(connection, transaction, "SELECT data FROM management_entries WHERE id=@id AND kind=@kind", ("@id", id), ("@kind", kind));
        var data = await query.ExecuteScalarAsync(ct) as byte[];
        return data is null ? null : JsonSerializer.Deserialize<DirectoryEntry>(security.Decrypt(id, "management-entry", data));
    }
    public async Task<DirectoryResult> ChangeAsync(string kind, string? id, DirectoryChange input, string author, string operationId, CancellationToken ct)
    {
        ManagementDirectory.Kind(kind);
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
        if (!await MySqlClientWriteLock.TryAcquireAsync(connection, ct)) throw new IdentityProblem(409, "Existe outra alteração em curso. Volta a tentar.");
        try
        {
            await using var transaction = await connection.BeginTransactionAsync(ct); await Ready(connection, transaction, ct);
            var result = await ChangeInTransaction(connection, transaction, kind, id, input, author, operationId, ct);
            await transaction.CommitAsync(ct); return result;
        }
        catch (MySqlException error) when (error.Number is 1062 or 1451)
        { throw new IdentityProblem(409, error.Number == 1451 ? "O registo está em utilização e não pode ser eliminado. Podes desativá-lo." : "Os dados já estão registados. Pesquisa antes de criar novamente."); }
        finally { await MySqlClientWriteLock.ReleaseAsync(connection); }
    }
    internal Task<DirectoryResult> ChangeInTransaction(MySqlConnection connection, MySqlTransaction transaction, string kind, string? id,
        DirectoryChange input, string author, string operationId, CancellationToken ct) =>
        ClientCommands.Execute(MySqlClientStore.InTransaction(connection, transaction, ct), security, operationId, author,
            "Management:" + kind + ":" + id, input, time.GetUtcNow().UtcDateTime, async () =>
        {
            var previous = id is null ? null : await ReadEntry(connection, transaction, kind, id, security, ct);
            if (id is not null && previous is null) throw new IdentityProblem(404, "Registo não encontrado. Pode ter sido eliminado.");
            var next = ManagementDirectory.Apply(kind, id ?? Guid.NewGuid().ToString("D"), previous, input, author, time.GetUtcNow());
            if (input.Action == "Save")
            {
                await using var check = Query(connection, transaction, "SELECT id,data FROM management_entries WHERE kind=@kind AND identity_hash=@hash AND id<>@id", ("@kind", kind), ("@hash", IdentityHash(next)), ("@id", next.Id));
                await using var reader = await check.ExecuteReaderAsync(ct);
                if (await reader.ReadAsync(ct)) return new DirectoryResult(false,
                        kind == "Supplier" ? "Já existe um fornecedor com esta identificação fiscal." : "Já existe uma categoria com este nome.", Decode(reader.GetGuid(0).ToString("D"), (byte[])reader[1]), true);
            }
            await Persist(connection, transaction, previous, next, ManagementDirectory.HistoryAction(input, previous), ct);
            return new DirectoryResult(true, input.Action switch { "Activate" => "Registo reativado.", "Deactivate" => "Registo desativado.", "Delete" => "Registo eliminado. A auditoria foi conservada.", _ => "Registo guardado." }, next);
        });
    private string IdentityHash(DirectoryEntry entry) => security.CommandHash("management-identity:" + entry.Kind + ":" + ManagementDirectory.Identity(entry));
    internal async Task Persist(MySqlConnection connection, MySqlTransaction transaction, DirectoryEntry? previous, DirectoryEntry next, string action, CancellationToken ct)
    {
        var data = security.Encrypt(next.Id, "management-entry", JsonSerializer.Serialize(next));
        var sql = next.Deleted ? "DELETE FROM management_entries WHERE id=@id AND version=@previous"
            : previous is null ? "INSERT INTO management_entries(id,kind,identity_hash,active,version,data) VALUES(@id,@kind,@hash,@active,@version,@data)"
            : "UPDATE management_entries SET identity_hash=@hash,active=@active,version=@version,data=@data WHERE id=@id AND version=@previous";
        await using (var command = Query(connection, transaction, sql, ("@id", next.Id), ("@kind", next.Kind), ("@hash", IdentityHash(next)), ("@active", next.Active), ("@version", next.Version), ("@data", data), ("@previous", previous?.Version)))
            if (await command.ExecuteNonQueryAsync(ct) != 1) throw new IdentityProblem(409, "O registo mudou. Volta a abrir antes de confirmar.");
        await using var history = Query(connection, transaction, "INSERT INTO management_entry_history(entry_id,kind,version,action,data) VALUES(@id,@kind,@version,@action,@data)",
            ("@id", next.Id), ("@kind", next.Kind), ("@version", next.Version), ("@action", action), ("@data", data));
        await history.ExecuteNonQueryAsync(ct);
    }
}
