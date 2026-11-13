using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MySql.Data.MySqlClient;
using PaCT.Api.Identity;
using PaCT.Api.Sharing;
using PaCT.Api.Infrastructure;

namespace PaCT.Api.Controllers;

public sealed class ShareForm
{
    public long Version { get; set; }
    public string? Text { get; set; }
    public string? Link { get; set; }
    public string? AgendaReference { get; set; }
    public string[] RemoveMediaIds { get; set; } = [];
}

public sealed record ShareDecision(string Action, long Version);
public sealed record ShareReaction(string? Reaction, bool? Liked = null);
public sealed record ShareCommentInput(string? Text, long Version = 0, bool Delete = false);
public sealed record SharePermission(bool Allowed);

[ApiController, Route("api/sharing"), Authorize(Roles = Roles.ManagersAndClient)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class SharingController(SharingStore store, SharingMedia media, SharingAgenda agenda, IIdentityStore accounts, TimeProvider time) : ControllerBase
{
    private string? Viewer => User.FindFirstValue(ClaimTypes.NameIdentifier);
    private bool Manager => Roles.IsManager(User.FindFirstValue(ClaimTypes.Role));
    private async Task<IdentityAccount> Actor(CancellationToken ct) => Viewer is { } id && await accounts.FindAsync(id, ct) is { } account
        ? account : throw new IdentityProblem(401, "Inicia sessão para continuar.");
    private async Task<bool> MayPublish(CancellationToken ct) => Manager || Viewer is { } id && await store.CanPublishAsync(id, ct);

    [AllowAnonymous, HttpGet]
    public async Task<IActionResult> Feed(string scope = "feed", int page = 1, DateTimeOffset? before = null, CancellationToken ct = default)
    {
        if (ct.IsCancellationRequested) return StatusCode(StatusCodes.Status499ClientClosedRequest);
        if (page is < 1 or > 100000 || scope is not ("feed" or "mine" or "moderation"))
            throw new IdentityProblem(400, "Escolhe uma página de Partilhas válida.");
        if (scope == "mine" && Viewer is null || scope == "moderation" && !Manager) return Forbid();
        try
        {
            // Complete this paged read within the database timeouts if the browser disconnects.
            var readToken = CancellationToken.None;
            const int pageSize = 8;
            var now = time.GetUtcNow();
            var snapshot = before is { } date && date < now ? date : now;
            var (total, rows, currentPage, currentSnapshot) = await store.ListAsync(scope, Viewer, snapshot, now, page, pageSize, readToken);
            var canPublish = await MayPublish(readToken);
            var names = new Dictionary<string, string>();
            var items = new List<object>();
            foreach (var row in rows)
            {
                var comments = new List<object>();
                foreach (var comment in row.Comments.Where(c => !c.Deleted))
                    comments.Add(new { comment.Id, comment.CreatedAt, comment.Text, comment.Version,
                        author = await Name(comment.AuthorId), own = Viewer == comment.AuthorId });
                var reactionCounts = row.Reactions.Values.GroupBy(value => value).ToDictionary(group => group.Key, group => group.Count());
                var myReaction = Viewer is { } viewer ? row.Reactions.GetValueOrDefault(viewer) : null;
                items.Add(new
                {
                    row.Id, row.Text, row.Link, row.AgendaReference, row.CreatedAt, row.Version, row.Status,
                    author = await Name(row.AuthorId), own = row.AuthorId == Viewer, canEdit = (Manager || canPublish && row.AuthorId == Viewer && row.Status != "Rejected"),
                    media = row.Media.Select(m =>
                    {
                        var url = $"/api/sharing/{row.Id}/media/{m.Id}";
                        return new { m.Id, m.Type, url, posterUrl = m.Type == "video/mp4" ? url + "?poster=true" : null };
                    }),
                    reactionCounts, myReaction, likeCount = reactionCounts.GetValueOrDefault(SharingReactions.Like),
                    liked = myReaction == SharingReactions.Like, comments
                });
            }
            if (ct.IsCancellationRequested) return StatusCode(StatusCodes.Status499ClientClosedRequest);
            return Ok(new { total, pageSize, page = currentPage, before = currentSnapshot, canPublish, items });

            async Task<string> Name(string id)
            {
                if (names.TryGetValue(id, out var existing)) return existing;
                var name = (await accounts.FindAsync(id, readToken))?.DisplayName;
                return names[id] = string.IsNullOrWhiteSpace(name) ? "Conta PaCT" : name;
            }
        }
        catch (MySqlException error) when (error.Number == 1146)
        {
            throw new IdentityProblem(503, "A área de Partilhas ainda está a ser preparada.");
        }
    }

    [HttpGet("capabilities")]
    public async Task<IActionResult> Capabilities(CancellationToken ct)
    {
        if (ct.IsCancellationRequested) return StatusCode(StatusCodes.Status499ClientClosedRequest);
        bool canPublish;
        try { canPublish = await MayPublish(CancellationToken.None); }
        catch (MySqlException error) when (error.Number == 1146) { canPublish = false; }
        if (ct.IsCancellationRequested) return StatusCode(StatusCodes.Status499ClientClosedRequest);
        return Ok(new { canPublish });
    }

    [AllowAnonymous, HttpGet("agenda")]
    public async Task<IActionResult> Agenda(string reference, CancellationToken ct) =>
        Ok(await agenda.FindAsync(reference, Viewer is not null, ct));

    [HttpPost("{id:guid}"), EnableRateLimiting("upload"), RequestSizeLimit(SharingMedia.RequestLimit),
     RequestFormLimits(MultipartBodyLengthLimit = SharingMedia.RequestLimit, ValueLengthLimit = 10000)]
    public async Task<IActionResult> Save(Guid id, [FromForm] ShareForm form, CancellationToken ct)
    {
        var actor = await Actor(ct);
        if (!await MayPublish(ct)) return Forbid();
        var postId = id.ToString();
        var existing = await store.FindAsync(postId, ct);
        if (existing is not null) CanEdit(existing, actor);
        var files = Request.Form.Files;
        if (files.Any(f => f.Name is not ("images" or "video" or "audio")) || files.Count(f => f.Name == "images") > 5 || files.Count(f => f.Name == "video") > 1 || files.Count(f => f.Name == "audio") > 1)
            throw new IdentityProblem(400, "Podes juntar até cinco imagens, um vídeo e um áudio por publicação.");
        var text = CleanText(form.Text, 5000);
        var link = CleanLink(form.Link);
        var reference = SharingAgenda.Normalize(form.AgendaReference);
        var uploads = new List<ShareUpload>();
        foreach (var file in files) uploads.Add(await media.ReadAsync(file, ct));
        var removed = form.RemoveMediaIds.Distinct().Order(StringComparer.Ordinal).ToArray();
        if (reference is not null && reference != existing?.AgendaReference) await agenda.FindAsync(reference, true, ct);
        var hash = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
        {
            text, link, reference, removed, media = uploads.Select(u => new { u.Media.Type, u.Media.Hash })
        })));
        await store.ChangeAsync(postId, actor, (current, canPublish) =>
        {
            if (!canPublish) throw new IdentityProblem(403, "A tua conta não tem autorização para publicar.");
            if (current is not null)
            {
                CanEdit(current, actor);
                if (current.LastSaveActor == actor.Id && current.LastSaveVersion == form.Version && current.LastSaveHash == hash) return current;
                RequireVersion(current, form.Version);
            }
            else if (form.Version != 0) throw new IdentityProblem(404, "Publicação indisponível.");
            var existingMedia = current?.Media ?? [];
            if (removed.Any(id => !existingMedia.Any(m => m.Id == id))) throw new IdentityProblem(400, "Revê os anexos que queres retirar.");
            var attachments = existingMedia.Where(m => !removed.Contains(m.Id)).Concat(uploads.Select(u => u.Media)).ToArray();
            if (attachments.Count(m => m.Type.StartsWith("image/", StringComparison.Ordinal)) > 5 || attachments.Count(m => m.Type == "video/mp4") > 1 || attachments.Count(m => AudioAttachment.IsAudio(m.Type)) > 1)
                throw new IdentityProblem(400, "Podes juntar até cinco imagens, um vídeo e um áudio por publicação.");
            if (text.Length == 0 && link is null && reference is null && attachments.Length == 0)
                throw new IdentityProblem(400, "Escreve algo ou junta uma imagem, um vídeo, um áudio ou uma ligação.");
            var now = time.GetUtcNow();
            if (current is null) return new(postId, actor.Id, now, Manager ? "Approved" : "Pending", text, link, reference, attachments, 1,
                [new(actor.Id, now, "Published")], [], [], hash, actor.Id, form.Version, Manager);
            if (text == current.Text && link == current.Link && reference == current.AgendaReference
                && attachments.Select(m => (m.Type, m.Hash)).SequenceEqual(current.Media.Select(m => (m.Type, m.Hash)))) return current;
            var status = current.Status == "Hidden" ? "Hidden" : current.ManagerPost ? "Approved" : "Pending";
            return current with
            {
                Text = text, Link = link, AgendaReference = reference, Media = attachments, Status = status, Version = current.Version + 1,
                History = [..current.History, new(actor.Id, now, "Edited", current.Text, current.Link, current.AgendaReference, current.Media)],
                LastSaveHash = hash, LastSaveActor = actor.Id, LastSaveVersion = form.Version
            };
        }, uploads, ct);
        return Ok(new { confirmed = true, id = postId });
    }

    [HttpPost("{id:guid}/decision"), EnableRateLimiting("write")]
    public async Task<IActionResult> Decide(Guid id, ShareDecision input, CancellationToken ct)
    {
        var actor = await Actor(ct);
        await store.ChangeAsync(id.ToString(), actor, (row, _) =>
        {
            if (row is null) throw Missing();
            var next = input.Action switch
            {
                "delete" when row.AuthorId == actor.Id && row.Status != "Deleted" => "Deleted",
                "approve" when Manager && row.Status == "Pending" => "Approved",
                "reject" when Manager && row.Status == "Pending" => "Rejected",
                "hide" when Manager && row.IsPublic => "Hidden",
                "restore" when Manager && row.Status == "Hidden" => row.ManagerPost ? "Approved" : "Pending",
                _ => null
            };
            if (next is null) throw new IdentityProblem(409, "Esta ação não está disponível para a publicação atual.");
            RequireVersion(row, input.Version);
            return row with { Status = next, Version = row.Version + 1, History = [..row.History, new(actor.Id, time.GetUtcNow(), next)] };
        }, null, ct);
        return Ok(new { confirmed = true });
    }

    [HttpPost("{id:guid}/reaction"), EnableRateLimiting("write")]
    public async Task<IActionResult> React(Guid id, ShareReaction input, CancellationToken ct)
    {
        var reaction = input.Liked is true ? SharingReactions.Like : input.Reaction;
        if (reaction is not null && !SharingReactions.IsAllowed(reaction))
            throw new IdentityProblem(400, "Escolhe uma das reações disponíveis.");
        var actor = await Actor(ct);
        await store.ChangeAsync(id.ToString(), actor, (row, _) =>
        {
            if (row?.IsPublic != true) throw Missing();
            var current = row.Reactions.GetValueOrDefault(actor.Id);
            if (current == reaction || input.Liked is false && current != SharingReactions.Like) return row;
            var reactions = new Dictionary<string, string>(row.Reactions, StringComparer.Ordinal);
            if (reaction is null) reactions.Remove(actor.Id);
            else reactions[actor.Id] = reaction;
            return row with { Reactions = reactions };
        }, null, ct);
        return Ok(new { confirmed = true });
    }

    [HttpPost("{id:guid}/comments/{commentId:guid}"), EnableRateLimiting("write")]
    public async Task<IActionResult> Comment(Guid id, Guid commentId, ShareCommentInput input, CancellationToken ct)
    {
        var actor = await Actor(ct);
        var key = commentId.ToString();
        var text = CleanText(input.Text, 2000);
        await store.ChangeAsync(id.ToString(), actor, (row, canPublish) =>
        {
            if (row?.IsPublic != true && !(Manager && row?.Status is "Hidden" or "Rejected" && input.Delete)) throw Missing();
            var post = row!;
            var current = post.Comments.SingleOrDefault(c => c.Id == key);
            if (current is not null && current.AuthorId != actor.Id && !(Manager && input.Delete)) throw Missing();
            if (current?.Deleted == true) { if (input.Delete) return post; throw Missing(); }
            var now = time.GetUtcNow();
            if (!input.Delete && (text.Length == 0 || !canPublish || current is null && post.Status != "Approved"))
                throw new IdentityProblem(400, "Para comentar, a publicação tem de estar aprovada e a tua conta autorizada.");
            if (current is null)
            {
                if (input.Delete || input.Version != 0) throw Missing();
                return post with { Comments = [..post.Comments, new(key, actor.Id, now, text)] };
            }
            if (!input.Delete && current.Text == text) return post;
            if (current.Version != input.Version) throw new IdentityProblem(409, "O comentário mudou. Atualiza antes de continuar.");
            var next = current with { Text = input.Delete ? current.Text : text, Deleted = input.Delete, Version = current.Version + 1,
                History = [..(current.History ?? []), new(actor.Id, now, input.Delete ? "Deleted" : "Edited", current.Text)] };
            return post with { Comments = post.Comments.Select(c => c.Id == key ? next : c).ToArray() };
        }, null, ct);
        return Ok(new { confirmed = true });
    }

    [HttpGet("{id:guid}/history")]
    public async Task<IActionResult> History(Guid id, CancellationToken ct)
    {
        var row = await store.FindAsync(id.ToString(), ct);
        if (row is null || !Manager && row.AuthorId != Viewer) throw Missing();
        var revisions = new List<object>();
        foreach (var change in row.History)
            revisions.Add(new { author = (await accounts.FindAsync(change.ActorId, ct))?.DisplayName, change.At, change.Action,
                change.Text, change.Link, change.AgendaReference });
        return Ok(revisions);
    }

    [AllowAnonymous, HttpGet("{id:guid}/media/{mediaId:guid}")]
    public async Task<IActionResult> Media(Guid id, Guid mediaId, CancellationToken ct, bool poster = false)
    {
        var row = await store.FindAsync(id.ToString(), ct);
        if (row is null || row.Status == "Deleted" || !row.IsPublic && !Manager && row.AuthorId != Viewer) return NotFound();
        var item = row.Media.SingleOrDefault(m => m.Id == mediaId.ToString());
        if (item is null) return NotFound();
        if (poster)
        {
            if (item.Type != "video/mp4") return NotFound();
            var image = await media.GetPosterAsync(row.Id, item.Id, ct);
            return image is null ? NotFound() : File(image, "image/jpeg");
        }
        var bytes = await store.ReadMediaAsync(row.Id, item.Id, ct);
        return bytes is null ? NotFound() : File(bytes, item.Type, enableRangeProcessing: item.Type == "video/mp4" || AudioAttachment.IsAudio(item.Type));
    }

    [Authorize(Roles = Roles.Managers), HttpGet("permissions/{personId:guid}")]
    public async Task<IActionResult> Permission(Guid personId, CancellationToken ct) =>
        Ok(new { allowed = await store.PermissionAsync(personId.ToString(), null, null, time.GetUtcNow(), ct) });

    [Authorize(Roles = Roles.Managers), HttpPost("permissions/{personId:guid}")]
    public async Task<IActionResult> Permission(Guid personId, SharePermission input, CancellationToken ct) =>
        Ok(new { allowed = await store.PermissionAsync(personId.ToString(), (await Actor(ct)).Id, input.Allowed, time.GetUtcNow(), ct) });

    private static IdentityProblem Missing() => new(404, "Publicação ou comentário indisponível.");
    private static void RequireVersion(SharePost post, long version)
    {
        if (post.Version != version) throw new IdentityProblem(409, "A publicação mudou. Atualiza antes de continuar.");
    }

    private static void CanEdit(SharePost row, IdentityAccount actor)
    {
        if (row.Status == "Deleted" || !Roles.IsManager(actor.Role) && (row.AuthorId != actor.Id || row.Status == "Rejected")) throw Missing();
    }

    private static string CleanText(string? value, int limit)
    {
        var text = (value ?? "").Trim();
        if (text.Length > limit) throw new IdentityProblem(400, $"O texto pode ter até {limit} caracteres.");
        return text;
    }

    private static string? CleanLink(string? value)
    {
        var text = CleanText(value, 2048);
        if (text.Length == 0) return null;
        if (!Uri.TryCreate(text, UriKind.Absolute, out var url) || url.Scheme is not ("https" or "http") || url.UserInfo.Length > 0 || url.Host.Length == 0)
            throw new IdentityProblem(400, "Indica uma ligação completa que comece por https:// ou http://.");
        return url.AbsoluteUri;
    }
}
