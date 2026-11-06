using System.Text.Json;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;
using static PaCT.Api.Management.MySqlManagementStore;

namespace PaCT.Api.Management;

public sealed class PrivacyStore(DatabaseConnectionSettings settings, TimeProvider time, IHostEnvironment environment)
{
    private sealed record DraftRow(long Revision, PrivacyContent? Content, DateTime? UpdatedAt);
    private const string DraftChanged = "O rascunho mudou noutra janela. Consulta a versão mais recente.";
    internal const int PageSize = 8;
    private const string IsTestDocument = "JSON_CONTAINS_PATH(content,'one','$.TestOnly')";
    private const string PublishedVersions = $"version>0 AND (@includeTests OR {IsTestDocument}=0)";
    internal const string PushPermitted = $"""
        COALESCE((SELECT COALESCE((SELECT accepted FROM privacy_choices WHERE account_id=a.id AND purpose='push'
                                  AND document_version=policy.version ORDER BY id DESC LIMIT 1),0)
                  FROM privacy_documents policy WHERE {PublishedVersions} ORDER BY version DESC LIMIT 1),1)=1
        """;
    private readonly bool includeTests = environment.IsDevelopment();

    public async Task<PrivacyPublication?> PublishedAsync(CancellationToken ct)
    {
        if (!settings.IsConfigured) return null;
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        try { return await Publication(connection, null, null, ct); }
        catch (MySqlException error) when (error.Number == 1146) { return null; }
    }

    public Task<PrivacyEditor> EditorAsync(int page, CancellationToken ct) => WithDraft(async (connection, tx, draft) =>
    {
        var (version, total, testOnly) = await Latest(connection, tx, ct);
        await using var query = Query(connection, tx, $"""
            SELECT version,author_id,recorded_at,{IsTestDocument} FROM privacy_documents
            WHERE {PublishedVersions} ORDER BY version DESC LIMIT @count OFFSET @offset
            """, ("@includeTests", includeTests), ("@count", PageSize), ("@offset", (page - 1) * PageSize));
        await using var rows = await query.ExecuteReaderAsync(ct);
        var history = new List<PrivacyRevision>();
        while (await rows.ReadAsync(ct))
            history.Add(new(rows.GetInt64(0), rows.GetGuid(1).ToString("D"), Utc(rows.GetDateTime(2)), rows.GetBoolean(3)));
        var content = draft.Content ?? PrivacyContent.Draft();
        return new PrivacyEditor(draft.Revision, version, content, draft.UpdatedAt, [.. history], total,
            content.PendingSections(), includeTests, testOnly);
    }, ct);

    public async Task<PrivacyPublication> ReadVersionAsync(long version, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        try
        {
            return await Publication(connection, null, version, ct)
                ?? throw new IdentityProblem(404, "Esta versão da política não existe.");
        }
        catch (MySqlException error) when (error.Number == 1146) { throw Unprepared(); }
    }

    public Task<long> SaveAsync(PrivacyDraftInput input, string author, CancellationToken ct) =>
        WithDraft(async (connection, tx, draft) =>
        {
            var content = input.Content.Validate();
            if (draft.Content == content) return draft.Revision;
            CheckRevision(input.Revision, draft.Revision);
            await using var update = Query(connection, tx, """
                UPDATE privacy_documents SET content=@content, author_id=@author, recorded_at=@at, revision=revision+1 WHERE version=0
                """, ("@content", JsonSerializer.Serialize(content)), ("@author", author), ("@at", time.GetUtcNow().UtcDateTime));
            await update.ExecuteNonQueryAsync(ct);
            return draft.Revision + 1;
        }, ct);

    internal Task<PrivacyPublishResult> PublishAsync(long revision, string author, CancellationToken ct) =>
        WithDraft<PrivacyPublishResult>(async (connection, tx, draft) =>
        {
            if (revision != draft.Revision) return new(409, Message: DraftChanged);
            if (!includeTests && draft.Content is null) return new(400, Message: "Guarda o rascunho antes de publicar.");
            var content = draft.Content ?? PrivacyContent.Draft();
            var pending = content.PendingSections();
            if (!includeTests && pending.Length > 0)
                return new(400, Message: "Completa estas secções do rascunho: " + string.Join("; ", pending) + ".");
            var previous = await Publication(connection, tx, null, ct);
            if (previous?.Content == content && previous.TestOnly == includeTests) return new(200, previous);
            // Allocate globally so decisions always refer to one immutable version.
            await using var latest = Query(connection, tx, "SELECT COALESCE(MAX(version),0) FROM privacy_documents");
            var version = Convert.ToInt64(await latest.ExecuteScalarAsync(ct)) + 1;
            var now = time.GetUtcNow().UtcDateTime;
            await using var insert = Query(connection, tx, """
                INSERT INTO privacy_documents(version,content,author_id,recorded_at) VALUES(@version,@content,@author,@at)
                """, ("@version", version), ("@content", SerializePublication(content, includeTests)), ("@author", author), ("@at", now));
            await insert.ExecuteNonQueryAsync(ct);
            return new(200, new PrivacyPublication(version, content, now, includeTests));
        }, ct);

    public async Task<PrivacyChoice[]> ChoicesAsync(string account, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        try
        {
            await using var query = Query(connection, null, $"""
                WITH visible_choices AS (
                    SELECT c.id,c.document_version,c.purpose,c.accepted,c.decided_at
                    FROM privacy_choices c JOIN privacy_documents ON version=c.document_version
                    WHERE c.account_id=@account AND {PublishedVersions}
                )
                SELECT document_version,purpose,accepted,decided_at FROM visible_choices
                WHERE id IN (SELECT MAX(id) FROM visible_choices GROUP BY purpose)
                    OR id IN (SELECT id FROM (SELECT id FROM visible_choices ORDER BY id DESC LIMIT 20) AS recent)
                ORDER BY id DESC
                """, ("@account", account), ("@includeTests", includeTests));
            await using var rows = await query.ExecuteReaderAsync(ct);
            var choices = new List<PrivacyChoice>();
            while (await rows.ReadAsync(ct)) choices.Add(ReadChoice(rows));
            return [.. choices];
        }
        catch (MySqlException error) when (error.Number == 1146) { throw Unprepared(); }
    }

    public Task<PrivacyChoice> DecideAsync(string account, PrivacyChoiceInput input, CancellationToken ct) =>
        WithDraft(async (connection, tx, _) =>
        {
            if (input.OperationId == Guid.Empty || input.Purpose is not (PrivacyPurposes.Reading or PrivacyPurposes.Push))
                throw new IdentityProblem(400, "A decisão de privacidade não é válida.");
            var operation = input.OperationId.ToString("D");
            await using (var existing = Query(connection, tx, $"""
                SELECT document_version,purpose,accepted,decided_at,{IsTestDocument}
                FROM privacy_choices JOIN privacy_documents ON version=document_version
                WHERE account_id=@account AND operation_id=@operation
                """, ("@account", account), ("@operation", operation)))
            await using (var rows = await existing.ExecuteReaderAsync(ct))
            {
                if (await rows.ReadAsync(ct))
                {
                    if (!includeTests && rows.GetBoolean(4))
                        throw new IdentityProblem(409, "Esta decisão pertence a uma versão de teste.");
                    var choice = ReadChoice(rows);
                    if (choice.Version != input.Version || choice.Purpose != input.Purpose || choice.Accepted != input.Accepted)
                        throw new IdentityProblem(409, "Esta decisão já foi registada com outros valores.");
                    return choice;
                }
            }
            var (latest, _, _) = await Latest(connection, tx, ct);
            if (latest == 0 || input.Version != latest)
                throw new IdentityProblem(409, "A política foi atualizada. Consulta a versão atual antes de decidir.");
            var now = time.GetUtcNow().UtcDateTime;
            await using var insert = Query(connection, tx, """
                INSERT INTO privacy_choices(account_id,operation_id,document_version,purpose,accepted,decided_at)
                VALUES(@account,@operation,@version,@purpose,@accepted,@at)
                """, ("@account", account), ("@operation", operation), ("@version", latest),
                ("@purpose", input.Purpose), ("@accepted", input.Accepted), ("@at", now));
            await insert.ExecuteNonQueryAsync(ct);
            return new PrivacyChoice(latest, input.Purpose, input.Accepted, now);
        }, ct);

    internal static async Task SetInstallationDraft(MySqlConnection connection, MySqlTransaction tx, string author,
        PrivacyControllerDetails details, DateTime now, CancellationToken ct)
    {
        await using var write = Query(connection, tx, """
            UPDATE privacy_documents SET revision=revision+1,content=@content,author_id=@author,recorded_at=@at
            WHERE version=0 AND content IS NULL
            """, ("@content", JsonSerializer.Serialize(PrivacyContent.Draft(details))), ("@author", author), ("@at", now));
        try
        {
            if (await write.ExecuteNonQueryAsync(ct) != 1) throw Unprepared();
        }
        catch (MySqlException error) when (error.Number == 1146) { throw Unprepared(); }
    }

    private async Task<T> WithDraft<T>(Func<MySqlConnection, MySqlTransaction, DraftRow, Task<T>> action, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        await using var tx = await connection.BeginTransactionAsync(ct);
        try
        {
            DraftRow draft;
            await using (var query = Query(connection, tx, "SELECT revision,content,recorded_at FROM privacy_documents WHERE version=0 FOR UPDATE"))
            await using (var rows = await query.ExecuteReaderAsync(ct))
            {
                if (!await rows.ReadAsync(ct)) throw Unprepared();
                draft = new(rows.GetInt64(0), rows.IsDBNull(1) ? null : Deserialize(rows.GetString(1)),
                    rows.IsDBNull(2) ? null : Utc(rows.GetDateTime(2)));
            }
            var result = await action(connection, tx, draft);
            await tx.CommitAsync(ct);
            return result;
        }
        catch (MySqlException error) when (error.Number == 1146) { throw Unprepared(); }
    }

    private async Task<(long Version, int Total, bool TestOnly)> Latest(MySqlConnection connection, MySqlTransaction tx, CancellationToken ct)
    {
        await using var query = Query(connection, tx, $"""
            SELECT version,{IsTestDocument},COUNT(*) OVER() FROM privacy_documents
            WHERE {PublishedVersions} ORDER BY version DESC LIMIT 1
            """, ("@includeTests", includeTests));
        await using var rows = await query.ExecuteReaderAsync(ct);
        return await rows.ReadAsync(ct) ? (rows.GetInt64(0), rows.GetInt32(2), rows.GetBoolean(1)) : (0, 0, false);
    }

    internal async Task<PrivacyPublication?> Publication(MySqlConnection connection, MySqlTransaction? tx, long? version, CancellationToken ct)
    {
        await using var query = Query(connection, tx, $"""
            SELECT version,content,recorded_at,{IsTestDocument} FROM privacy_documents
            WHERE {PublishedVersions} AND (@version IS NULL OR version=@version) ORDER BY version DESC LIMIT 1
            """, ("@includeTests", includeTests), ("@version", version));
        await using var rows = await query.ExecuteReaderAsync(ct);
        return await rows.ReadAsync(ct) ? new(rows.GetInt64(0), Deserialize(rows.GetString(1)), Utc(rows.GetDateTime(2)), rows.GetBoolean(3)) : null;
    }

    internal static string SerializePublication(PrivacyContent content, bool testOnly)
    {
        if (!testOnly) return JsonSerializer.Serialize(content);
        var publication = JsonSerializer.SerializeToNode(content)!.AsObject();
        publication["TestOnly"] = true;
        return publication.ToJsonString();
    }

    private static PrivacyContent Deserialize(string json) => JsonSerializer.Deserialize<PrivacyContent>(json)!;
    private static PrivacyChoice ReadChoice(System.Data.Common.DbDataReader rows) =>
        new(rows.GetInt64(0), rows.GetString(1), rows.GetBoolean(2), Utc(rows.GetDateTime(3)));
    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);
    private static IdentityProblem Unprepared() => new(503, "A gestão de privacidade ainda precisa de preparação na base de dados.");
    private static void CheckRevision(long expected, long actual)
    {
        if (expected != actual) throw new IdentityProblem(409, DraftChanged);
    }
}
