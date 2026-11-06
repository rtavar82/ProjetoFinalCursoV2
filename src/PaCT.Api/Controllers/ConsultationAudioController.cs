using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;
using PaCT.Api.Infrastructure;
using PaCT.Api.Sharing;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/consultations/{id:guid}/messages"), Authorize(Roles = Roles.ManagersAndClient)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ConsultationAudioController(IConsultationStore store, IIdentityStore accounts, ConsultationPhotoStore photos) : ControllerBase
{
    private async Task<ConsultationActor> Actor(CancellationToken ct)
    {
        var account = await accounts.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, ct)
            ?? throw new IdentityProblem(401, "Inicia sessão novamente.");
        return new(account.Id, account.PersonId, Roles.IsManager(account.Role));
    }

    [Authorize(Roles = Roles.Managers), HttpPost("audio"), EnableRateLimiting("upload"),
     RequestSizeLimit(AudioAttachment.RequestLimit), RequestFormLimits(MultipartBodyLengthLimit = AudioAttachment.Limit,
         ValueLengthLimit = 10000, ValueCountLimit = ConsultationConversation.MaxReplyReadIds + 25)]
    public async Task<IActionResult> Send(Guid id, [FromForm] Guid operationId, [FromForm] long conversationVersion,
        [FromForm] string? messageText, [FromForm] string[] photoIds, [FromForm] IFormFile audio, [FromForm] string? messageVideoId,
        [FromForm] string[]? messageIds,
        [FromServices] ClosureMediaStore videos, CancellationToken ct)
    {
        var actor = await Actor(ct);
        if (!actor.IsManager) return Forbid();
        if (operationId == Guid.Empty) return BadRequest();
        var clip = await AudioAttachment.ReadAsync(audio, ct);
        var command = new ConsultationCommand
        {
            Action = "SendMessage", Id = id.ToString(), OperationId = operationId.ToString(),
            ConversationVersion = conversationVersion, MessageText = messageText, PhotoIds = photoIds,
            MessageAudioType = clip.ContentType, MessageVideoId = messageVideoId, MessageIds = messageIds is { Length: > 0 } ? messageIds : null
        };
        await photos.ValidateMessageAsync(command, actor.AccountId, ct);
        await videos.ValidateMessageVideoAsync(command, actor.AccountId, ct);
        return Ok(await store.ExecuteAudioMessageAsync(command, actor, clip, ct));
    }

    [Authorize(Roles = Roles.Managers), HttpPost("video/{videoId:guid}"), EnableRateLimiting("upload"),
     RequestSizeLimit(ClosureMediaStore.RequestLimit), RequestFormLimits(MultipartBodyLengthLimit = SharingMedia.VideoLimit)]
    public async Task<IActionResult> UploadVideo(Guid id, Guid videoId, [FromForm] long conversationVersion,
        [FromForm] IFormFile video, [FromServices] ClosureMediaStore videos, [FromServices] SharingMedia media, CancellationToken ct)
    {
        var actor = await Actor(ct);
        if (!actor.IsManager) return Forbid();
        if (videoId == Guid.Empty) return BadRequest();
        var target = await store.ReadAsync(data => ConsultationConversation.Authorized(data, id.ToString("D"), actor), ct);
        if (target.ConversationBlocked || target.ConversationVersion != conversationVersion)
            throw new IdentityProblem(409, "A conversa mudou ou está encerrada para novos envios.");
        if (video.Name != "video") return BadRequest();
        var clip = await media.ReadAsync(video, ct);
        await videos.SaveAsync(id, ClosureMediaStore.ConversationVideoScope, videoId, actor.AccountId, clip, ct);
        return Ok(new { id = videoId, confirmed = true });
    }

    [HttpGet("{messageId:guid}/video")]
    public async Task<IActionResult> ReadVideo(Guid id, Guid messageId, [FromServices] ClosureMediaStore videos, CancellationToken ct)
    {
        var actor = await Actor(ct);
        var reference = await store.ReadAsync(data => ConsultationConversation.VisibleVideo(data, id.ToString("D"), messageId.ToString("D"), actor), ct);
        if (!Guid.TryParse(reference, out var videoId)) return NotFound();
        var clip = await videos.ReadAsync(id, ClosureMediaStore.ConversationVideoScope, videoId, ct);
        return clip.Type == "video/mp4" ? File(clip.Bytes, clip.Type, enableRangeProcessing: true) : NotFound();
    }

    [HttpGet("{messageId:guid}/audio")]
    public async Task<IActionResult> Read(Guid id, Guid messageId, CancellationToken ct)
    {
        var audio = await store.ReadMessageAudioAsync(id.ToString(), messageId.ToString(), await Actor(ct), ct);
        return audio is null ? NotFound() : File(audio.Bytes, audio.ContentType, enableRangeProcessing: true);
    }
}
