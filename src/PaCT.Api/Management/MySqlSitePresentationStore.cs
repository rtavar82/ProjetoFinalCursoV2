using System.Text.Json;
using MySql.Data.MySqlClient;
using PaCT.Api.Clients;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Management;

public sealed record SiteEditSession(string Editor, bool Release = false, bool Renew = false);
public sealed record SitePublishInput(string Editor, long Version, Dictionary<string, string>? Values);
public sealed record SiteEditorView(long Version, SiteField[] Fields);
public sealed record SitePublicationResult(long Version);

public sealed class MySqlSitePresentationStore(DatabaseConnectionSettings settings, IdentitySecurity security, TimeProvider time)
{
    private sealed record EditLease(string? Author, string? Editor, DateTime? ExpiresAt);
    private const string Scope = "site-presentation";

    internal static async Task<SitePublication> ReadPublished(MySqlConnection connection, MySqlTransaction? transaction, IdentitySecurity security, CancellationToken ct)
    {
        try
        {
            await using var query = MySqlManagementStore.Query(connection, transaction,
                "SELECT version,data FROM site_presentation WHERE version>0 ORDER BY version DESC LIMIT 1");
            await using var rows = await query.ExecuteReaderAsync(ct);
            if (!await rows.ReadAsync(ct)) return SitePresentation.Default;
            var version = rows.GetInt64(0);
            return new(version, JsonSerializer.Deserialize<Dictionary<string, string>>(
                security.Decrypt(Scope, "publication-" + version, (byte[])rows[1]))!);
        }
        catch (MySqlException error) when (error.Number == 1146) { return SitePresentation.Default; }
    }

    public async Task<SitePublication> PublishedAsync(CancellationToken ct)
    {
        // Keep the approved static content available to installations without editorial storage.
        if (!settings.IsConfigured) return SitePresentation.Default;
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        return await ReadPublished(connection, null, security, ct);
    }

    public async Task<SiteEditorView> ReadAsync(string section, CancellationToken ct)
    {
        var fields = SitePresentation.Fields(section);
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        await using var query = MySqlManagementStore.Query(connection, null, "SELECT version FROM site_presentation WHERE version=0");
        try { if (await query.ExecuteScalarAsync(ct) is null) throw Unprepared(); }
        catch (MySqlException error) when (error.Number == 1146) { throw Unprepared(); }
        var published = await ReadPublished(connection, null, security, ct);
        return new(published.Version, fields.Select(field => field with { Value = published.Text(field.Key, field.Value) }).ToArray());
    }

    public Task<bool> EditAsync(SiteEditSession input, string author, CancellationToken ct) =>
        Write((connection, tx) => EditInTransaction(connection, tx, input, author, ct), ct);

    internal async Task<bool> EditInTransaction(MySqlConnection connection, MySqlTransaction tx, SiteEditSession input, string author, CancellationToken ct)
    {
        var lease = await ReadLease(connection, tx, ct);
        var now = time.GetUtcNow().UtcDateTime;
        var same = lease.Author == author && lease.Editor == input.Editor;
        if (input.Release && !same) return true;
        if ((input.Renew && (!same || lease.ExpiresAt is null || lease.ExpiresAt <= now))
            || (!input.Release && !same && lease.ExpiresAt > now))
            throw EditingConflict();
        await using var update = MySqlManagementStore.Query(connection, tx,
            "UPDATE site_presentation SET author_id=@author, editor_id=@editor, lease_until=@until WHERE version=0",
            ("@author", input.Release ? null : author), ("@editor", input.Release ? null : input.Editor), ("@until", input.Release ? null : now.AddMinutes(5)));
        await update.ExecuteNonQueryAsync(ct);
        return true;
    }

    public Task<SitePublicationResult> PublishAsync(string section, SitePublishInput input, string author, string operation, CancellationToken ct) =>
        Write((connection, tx) => PublishInTransaction(connection, tx, section, input, author, operation, ct), ct);

    internal async Task<SitePublicationResult> PublishInTransaction(MySqlConnection connection, MySqlTransaction tx, string section, SitePublishInput input,
        string author, string operation, CancellationToken ct)
    {
        var lease = await ReadLease(connection, tx, ct);
        var now = time.GetUtcNow().UtcDateTime;
        return await ClientCommands.Execute(MySqlClientStore.InTransaction(connection, tx, ct), security, operation, author,
                "SitePresentation:" + section, input, now, async () =>
            {
                if (lease.Author != author || lease.Editor != input.Editor || lease.ExpiresAt is null || lease.ExpiresAt <= now)
                    throw EditingConflict();
                var published = await ReadPublished(connection, tx, security, ct);
                if (input.Version != published.Version) throw new IdentityProblem(409, "Já existe uma publicação mais recente. Volta a abrir a edição.");
                var changes = new Dictionary<string, string>(published.Changes);
                var fields = SitePresentation.Fields(section);
                var values = SitePresentation.Validate(section, input.Values);
                foreach (var field in fields)
                {
                    if (values[field.Key] == field.Value) changes.Remove(field.Key);
                    else changes[field.Key] = values[field.Key];
                }
                var version = published.Version + 1;
                var bytes = security.Encrypt(Scope, "publication-" + version, JsonSerializer.Serialize(changes));
                await using var write = MySqlManagementStore.Query(connection, tx,
                    "INSERT INTO site_presentation(version,author_id,published_at,data) VALUES(@version,@author,@at,@data)",
                    ("@version", version), ("@author", author), ("@at", now), ("@data", bytes));
                await write.ExecuteNonQueryAsync(ct);
                return new SitePublicationResult(version);
            });
    }

    private async Task<T> Write<T>(Func<MySqlConnection, MySqlTransaction, Task<T>> change, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        await using var tx = await connection.BeginTransactionAsync(ct);
        var result = await change(connection, tx);
        await tx.CommitAsync(ct);
        return result;
    }

    private static async Task<EditLease> ReadLease(MySqlConnection connection, MySqlTransaction tx, CancellationToken ct)
    {
        try
        {
            await using var query = MySqlManagementStore.Query(connection, tx,
                "SELECT author_id,editor_id,lease_until FROM site_presentation WHERE version=0 FOR UPDATE");
            await using var rows = await query.ExecuteReaderAsync(ct);
            if (!await rows.ReadAsync(ct)) throw Unprepared();
            return new(rows.IsDBNull(0) ? null : rows.GetGuid(0).ToString("D"), rows.IsDBNull(1) ? null : rows.GetGuid(1).ToString("D"),
                rows.IsDBNull(2) ? null : rows.GetDateTime(2));
        }
        catch (MySqlException error) when (error.Number == 1146) { throw Unprepared(); }
    }

    private static IdentityProblem Unprepared() => new(503, "A edição da apresentação ainda precisa de preparação na base de dados.");
    private static IdentityProblem EditingConflict() => new(409, "A reserva de edição expirou ou está noutra janela. Volta a abrir a edição.");
}
