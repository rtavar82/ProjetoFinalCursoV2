using System.Text.Json;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Sharing;

public sealed record ShareMedia(string Id, string Type, string Hash);
public sealed record ShareUpload(ShareMedia Media, byte[] Bytes);
public sealed record ShareChange(string ActorId, DateTimeOffset At, string Action, string? Text = null,
    string? Link = null, string? AgendaReference = null, ShareMedia[]? Media = null);
public sealed record ShareComment(string Id, string AuthorId, DateTimeOffset CreatedAt, string Text, long Version = 1,
    bool Deleted = false, ShareChange[]? History = null);
public sealed record SharePost(string Id, string AuthorId, DateTimeOffset CreatedAt, string Status, string Text,
    string? Link, string? AgendaReference, ShareMedia[] Media, long Version, ShareChange[] History,
    ShareComment[] Comments, Dictionary<string, string> Reactions, string? LastSaveHash = null, string? LastSaveActor = null, long LastSaveVersion = 0, bool ManagerPost = false)
{
    public bool IsPublic => Status is "Pending" or "Approved";
}

internal static class SharingReactions
{
    public const string Like = "like";
    public static bool IsAllowed(string reaction) => reaction is Like or "love" or "smile" or "hands" or "wow" or "clap";
}

public sealed class SharingStore(DatabaseConnectionSettings settings, IdentitySecurity security)
{
    public async Task PrepareAsync(CancellationToken ct)
    {
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        string[] statements =
        [
            """
            CREATE TABLE IF NOT EXISTS sharing_posts (
                id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
                author_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                created_at DATETIME(6) NOT NULL,
                activity_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                status VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                version BIGINT NOT NULL,
                data LONGBLOB NOT NULL,
                KEY IX_sharing_feed (status,created_at,id),
                KEY IX_sharing_activity (status,activity_at,id),
                KEY IX_sharing_author (author_id,created_at,id)
            ) ENGINE=InnoDB
            """,
            """
            CREATE TABLE IF NOT EXISTS sharing_media (
                id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
                post_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                content LONGBLOB NOT NULL,
                poster MEDIUMBLOB NULL,
                FOREIGN KEY (post_id) REFERENCES sharing_posts (id)
            ) ENGINE=InnoDB
            """,
            """
            CREATE TABLE IF NOT EXISTS sharing_permissions (
                account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
                allowed BOOLEAN NOT NULL,
                history JSON NOT NULL
            ) ENGINE=InnoDB
            """
        ];
        foreach (var sql in statements)
        {
            await using var command = new MySqlCommand(sql, connection);
            await command.ExecuteNonQueryAsync(ct);
        }
        await using var check = new MySqlCommand("""
            SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sharing_media' AND COLUMN_NAME='poster'
            """, connection);
        if (Convert.ToInt32(await check.ExecuteScalarAsync(ct)) == 0)
        {
            await using var add = new MySqlCommand("ALTER TABLE sharing_media ADD COLUMN poster MEDIUMBLOB NULL", connection);
            try { await add.ExecuteNonQueryAsync(ct); }
            catch (MySqlException error) when (error.Number == 1060) { }
        }
        await PrepareActivityAsync(connection, ct);
    }

    private async Task PrepareActivityAsync(MySqlConnection connection, CancellationToken ct)
    {
        await using var check = new MySqlCommand("""
            SELECT IS_NULLABLE FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sharing_posts' AND COLUMN_NAME='activity_at'
            """, connection);
        var nullable = await check.ExecuteScalarAsync(ct) as string;
        if (nullable == "NO") return;
        if (nullable is null)
        {
            await using var add = new MySqlCommand("""
                ALTER TABLE sharing_posts ADD COLUMN activity_at DATETIME(6) NULL,
                    ADD INDEX IX_sharing_activity (status,activity_at,id)
                """, connection);
            await add.ExecuteNonQueryAsync(ct);
        }

        while (true)
        {
            await using var transaction = await connection.BeginTransactionAsync(ct);
            await using var query = new MySqlCommand("""
                SELECT id,data FROM sharing_posts WHERE activity_at IS NULL ORDER BY id LIMIT 64 FOR UPDATE
                """, connection, transaction);
            var rows = new List<(string Id, DateTime At)>();
            await using (var reader = await query.ExecuteReaderAsync(ct))
                while (await reader.ReadAsync(ct))
                {
                    var id = reader.GetGuid(0).ToString("D");
                    rows.Add((id, FeedActivity(Decode(id, (byte[])reader[1])).UtcDateTime));
                }

            await using var update = new MySqlCommand("UPDATE sharing_posts SET activity_at=@at WHERE id=@id", connection, transaction);
            var at = update.Parameters.AddWithValue("@at", DBNull.Value);
            var postId = update.Parameters.AddWithValue("@id", DBNull.Value);
            foreach (var row in rows)
            {
                at.Value = row.At;
                postId.Value = row.Id;
                await update.ExecuteNonQueryAsync(ct);
            }
            await transaction.CommitAsync(ct);
            if (rows.Count == 0) break;
        }

        await using var finish = new MySqlCommand("ALTER TABLE sharing_posts MODIFY COLUMN activity_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)", connection);
        await finish.ExecuteNonQueryAsync(ct);
    }

    internal static DateTimeOffset FeedActivity(SharePost post)
    {
        var lastEdit = post.History.Where(change => change.Action == "Edited")
            .Select(change => change.At).DefaultIfEmpty(post.CreatedAt).Max();
        var lastComment = post.Comments.Select(comment => comment.CreatedAt).DefaultIfEmpty(post.CreatedAt).Max();
        return lastEdit >= lastComment ? lastEdit : lastComment;
    }

    private async Task<MySqlConnection> OpenAsync(CancellationToken ct)
    {
        var connection = settings.CreateConnection();
        try { await connection.OpenAsync(ct); return connection; }
        catch { await connection.DisposeAsync(); throw; }
    }

    private SharePost Decode(string id, byte[] data) => DecodePost(security.Decrypt(id, "sharing-post", data));

    internal static SharePost DecodePost(string json)
    {
        var post = JsonSerializer.Deserialize<SharePost>(json)
            ?? throw new InvalidOperationException("Invalid sharing publication.");
        if (post.Reactions is not null) return post;
        using var document = JsonDocument.Parse(json);
        var likes = document.RootElement.TryGetProperty("Likes", out var entries) ? entries.Deserialize<string[]>() ?? [] : [];
        return post with { Reactions = likes.Distinct(StringComparer.Ordinal).ToDictionary(id => id, _ => SharingReactions.Like, StringComparer.Ordinal) };
    }

    public async Task<(int Total, SharePost[] Items, int Page, DateTimeOffset Before)> ListAsync(
        string scope, string? author, DateTimeOffset before, DateTimeOffset now, int page, int pageSize, CancellationToken ct)
    {
        var filter = scope switch
        {
            "mine" => "author_id=@author AND status<>'Deleted'",
            "moderation" => "status IN ('Pending','Hidden','Rejected')",
            _ => "status IN ('Pending','Approved')"
        };
        await using var connection = await OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, ct);
        if (scope == "feed" && page > 1 && before < now)
        {
            // Activity can move a post across page boundaries. Start a fresh list instead of skipping or duplicating posts.
            await using var changed = new MySqlCommand("""
                SELECT EXISTS(SELECT 1 FROM sharing_posts
                    WHERE status IN ('Pending','Approved') AND activity_at>@before AND created_at<=@before)
                """, connection, transaction);
            changed.Parameters.AddWithValue("@before", before.UtcDateTime);
            if (Convert.ToBoolean(await changed.ExecuteScalarAsync(ct)))
            {
                page = 1;
                before = now;
            }
        }
        var orderBy = scope == "feed" ? "activity_at" : "created_at";
        await using var count = new MySqlCommand("SELECT COUNT(*) FROM sharing_posts WHERE created_at<=@before AND " + filter, connection, transaction);
        count.Parameters.AddWithValue("@before", before.UtcDateTime);
        if (scope == "mine") count.Parameters.AddWithValue("@author", author);
        var total = Convert.ToInt32(await count.ExecuteScalarAsync(ct));
        await using var query = new MySqlCommand("SELECT id,data FROM sharing_posts WHERE created_at<=@before AND " + filter
            + $" ORDER BY {orderBy} DESC,id DESC LIMIT @size OFFSET @offset", connection, transaction);
        query.Parameters.AddWithValue("@before", before.UtcDateTime);
        if (scope == "mine") query.Parameters.AddWithValue("@author", author);
        query.Parameters.AddWithValue("@size", pageSize);
        query.Parameters.AddWithValue("@offset", (page - 1) * pageSize);
        var rows = new List<SharePost>();
        await using (var reader = await query.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) rows.Add(Decode(reader.GetGuid(0).ToString("D"), (byte[])reader[1]));
        await transaction.CommitAsync(ct);
        return (total, rows.ToArray(), page, before);
    }

    public async Task<SharePost?> FindAsync(string id, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        return await FindAsync(connection, null, id, ct);
    }

    private async Task<SharePost?> FindAsync(MySqlConnection connection, MySqlTransaction? transaction, string id, CancellationToken ct)
    {
        await using var query = new MySqlCommand("SELECT data FROM sharing_posts WHERE id=@id" + (transaction is null ? "" : " FOR UPDATE"), connection, transaction);
        query.Parameters.AddWithValue("@id", id);
        return await query.ExecuteScalarAsync(ct) is byte[] bytes ? Decode(id, bytes) : null;
    }

    public async Task<bool> CanPublishAsync(string accountId, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        return await CanPublishAsync(connection, null, accountId, ct);
    }

    private static async Task<bool> CanPublishAsync(MySqlConnection connection, MySqlTransaction? transaction, string accountId, CancellationToken ct)
    {
        await using var query = new MySqlCommand("SELECT allowed FROM sharing_permissions WHERE account_id=@id" + (transaction is null ? "" : " FOR UPDATE"), connection, transaction);
        query.Parameters.AddWithValue("@id", accountId);
        return Convert.ToBoolean(await query.ExecuteScalarAsync(ct));
    }

    public async Task<bool> PermissionAsync(string personId, string? actor, bool? allowed, DateTimeOffset at, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await using var account = new MySqlCommand("""
            SELECT a.id FROM accounts a INNER JOIN people p ON p.id=a.origin_person_id
            WHERE a.origin_person_id=@person AND a.role='Client' AND a.closed_at IS NULL
                AND a.email_confirmed_at IS NOT NULL AND a.link_status='Verified' AND p.is_active=1
            FOR UPDATE
            """, connection, transaction);
        account.Parameters.AddWithValue("@person", personId);
        var id = (await account.ExecuteScalarAsync(ct))?.ToString()
            ?? throw new IdentityProblem(404, "A ficha precisa de uma conta de cliente ativa e verificada.");
        var current = await CanPublishAsync(connection, transaction, id, ct);
        if (allowed is { } decision && decision != current)
        {
            await using var save = new MySqlCommand("""
                INSERT INTO sharing_permissions (account_id,allowed,history)
                VALUES (@id,@allowed,JSON_ARRAY(JSON_OBJECT('actorId',@actor,'at',@at,'allowed',@allowed)))
                ON DUPLICATE KEY UPDATE allowed=@allowed,
                    history=JSON_ARRAY_APPEND(history,'$',JSON_OBJECT('actorId',@actor,'at',@at,'allowed',@allowed))
                """, connection, transaction);
            save.Parameters.AddWithValue("@id", id);
            save.Parameters.AddWithValue("@allowed", decision);
            save.Parameters.AddWithValue("@actor", actor);
            save.Parameters.AddWithValue("@at", at.ToString("O"));
            await save.ExecuteNonQueryAsync(ct);
        }
        await transaction.CommitAsync(ct);
        return allowed ?? current;
    }

    public async Task<SharePost> ChangeAsync(string id, IdentityAccount actor,
        Func<SharePost?, bool, SharePost> change, IReadOnlyList<ShareUpload>? media, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        var canPublish = Roles.IsManager(actor.Role) || await CanPublishAsync(connection, transaction, actor.Id, ct);
        var current = await FindAsync(connection, transaction, id, ct);
        var next = change(current, canPublish);
        if (next != current)
        {
            await using var command = new MySqlCommand(current is null
                ? "INSERT INTO sharing_posts(id,author_id,created_at,activity_at,status,version,data) VALUES(@id,@author,@created,@activity,@status,@version,@data)"
                : "UPDATE sharing_posts SET activity_at=@activity,status=@status,version=@version,data=@data WHERE id=@id", connection, transaction);
            command.Parameters.AddWithValue("@id", next.Id);
            if (current is null)
            {
                command.Parameters.AddWithValue("@author", next.AuthorId);
                command.Parameters.AddWithValue("@created", next.CreatedAt.UtcDateTime);
            }
            command.Parameters.AddWithValue("@activity", FeedActivity(next).UtcDateTime);
            command.Parameters.AddWithValue("@status", next.Status);
            command.Parameters.AddWithValue("@version", next.Version);
            command.Parameters.AddWithValue("@data", security.Encrypt(next.Id, "sharing-post", JsonSerializer.Serialize(next)));
            await command.ExecuteNonQueryAsync(ct);
            foreach (var item in media ?? [])
            {
                if (!next.Media.Any(file => file.Id == item.Media.Id)) continue;
                await using var insert = new MySqlCommand("INSERT INTO sharing_media(id,post_id,content) VALUES(@media,@id,@content)", connection, transaction);
                insert.Parameters.AddWithValue("@media", item.Media.Id);
                insert.Parameters.AddWithValue("@id", id);
                insert.Parameters.AddWithValue("@content", item.Bytes);
                await insert.ExecuteNonQueryAsync(ct);
            }
        }
        await transaction.CommitAsync(ct);
        return next;
    }

    public async Task<byte[]?> ReadMediaAsync(string postId, string id, CancellationToken ct, bool poster = false)
    {
        await using var connection = await OpenAsync(ct);
        await using var query = new MySqlCommand(poster
            ? "SELECT poster FROM sharing_media WHERE post_id=@post AND id=@id"
            : "SELECT content FROM sharing_media WHERE post_id=@post AND id=@id", connection);
        query.Parameters.AddWithValue("@post", postId);
        query.Parameters.AddWithValue("@id", id);
        return await query.ExecuteScalarAsync(ct) as byte[];
    }

    public async Task SavePosterAsync(string postId, string id, byte[] poster, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var update = new MySqlCommand(
            "UPDATE sharing_media SET poster=@poster WHERE post_id=@post AND id=@id AND poster IS NULL", connection);
        update.Parameters.AddWithValue("@post", postId);
        update.Parameters.AddWithValue("@id", id);
        update.Parameters.AddWithValue("@poster", poster);
        await update.ExecuteNonQueryAsync(ct);
    }
}