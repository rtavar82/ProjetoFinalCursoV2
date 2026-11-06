using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;
using PaCT.Api.Infrastructure;

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
     RequestSizeLimit(AudioAttachment.RequestLimit), RequestFormLimits(MultipartBodyLengthLimit = AudioAttachment.Limit, ValueLengthLimit = 10000)]
    public async Task<IActionResult> Send(Guid id, [FromForm] Guid operationId, [FromForm] long conversationVersion,
        [FromForm] string? messageText, [FromForm] string[] photoIds, [FromForm] IFormFile audio, CancellationToken ct)
    {
        var actor = await Actor(ct);
        if (!actor.IsManager) return Forbid();
        if (operationId == Guid.Empty) return BadRequest();
        var clip = await AudioAttachment.ReadAsync(audio, ct);
        var command = new ConsultationCommand
        {
            Action = "SendMessage", Id = id.ToString(), OperationId = operationId.ToString(),
            ConversationVersion = conversationVersion, MessageText = messageText, PhotoIds = photoIds,
            MessageAudioType = clip.ContentType
        };
        await photos.ValidateMessageAsync(command, actor.AccountId, ct);
        return Ok(await store.ExecuteAudioMessageAsync(command, actor, clip, ct));
    }

    [HttpGet("{messageId:guid}/audio")]
    public async Task<IActionResult> Read(Guid id, Guid messageId, CancellationToken ct)
    {
        var audio = await store.ReadMessageAudioAsync(id.ToString(), messageId.ToString(), await Actor(ct), ct);
        return audio is null ? NotFound() : File(audio.Bytes, audio.ContentType, enableRangeProcessing: true);
    }
}
