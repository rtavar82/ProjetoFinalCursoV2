using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/consultations/{id:guid}/photos"), Authorize(Roles = Roles.ManagersAndClient)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ConsultationPhotosController(IConsultationStore consultations, IIdentityStore accounts, ConsultationPhotoStore photos, TimeProvider time) : ControllerBase
{
    [HttpPost("{photoId:guid}"), Authorize(Roles = Roles.Managers), EnableRateLimiting("upload"), RequestSizeLimit(5242880)]
    public async Task<IActionResult> Upload(string id, string photoId, [FromForm] IFormFile file, [FromForm] long version, [FromForm] long? conversationVersion, CancellationToken ct)
    {
        var allowed = await consultations.ReadAsync(data => data.Consultations.Any(c => c.Id == id && (conversationVersion is { } current
            ? c.State == "Performed" && c.ClosedAt is not null && !c.ConversationBlocked && c.ConversationVersion == current
            : c.Version == version && ProcessLifecycle.Substate(c, time.GetUtcNow()) == "AwaitingClosure")), ct);
        if (!allowed) return Conflict(new ProblemDetails { Status = 409, Title = conversationVersion is null ? "A consulta mudou ou já não permite preparar este fecho." : "A conversa mudou ou está encerrada para novos envios." });
        if (file.Length is 0 or > 4194304) return BadRequest(new ProblemDetails { Status = 400, Title = "Cada fotografia pode ter até 4 MB." });
        using var buffer = new MemoryStream(); await file.CopyToAsync(buffer, ct);
        await photos.SaveAsync(id, photoId, User.FindFirstValue(ClaimTypes.NameIdentifier)!, buffer.ToArray(), file.ContentType, ct);
        return Ok(new { id = photoId, confirmed = true });
    }

    [HttpGet("{photoId:guid}")]
    public async Task<IActionResult> Read(string id, string photoId, CancellationToken ct)
    {
        var account = await accounts.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, ct);
        if (account is null) return Unauthorized();
        var allowed = await consultations.ReadAsync(data => data.Consultations.Any(c => c.Id == id
            && (Roles.IsManager(account.Role) || c.State == "Performed" && c.PersonId == account.PersonId)
            && (c.PhotoIds.Contains(photoId) || data.Messages.Any(m => m.ConsultationId == id && m.PhotoIds?.Contains(photoId) == true))), ct);
        if (!allowed) return NotFound();
        var photo = await photos.ReadAsync(id, photoId, ct);
        return File(photo.Bytes, photo.ContentType, enableRangeProcessing: false);
    }
}
