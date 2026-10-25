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
    public async Task<IActionResult> Upload(string id, string photoId, [FromForm] IFormFile file, [FromForm] long version, CancellationToken ct)
    {
        var allowed = await consultations.ReadAsync(data => data.Consultations.Any(c => c.Id == id && c.Version == version && ConsultationRules.State(c, time.GetUtcNow()) == "AwaitingClosure"), ct);
        if (!allowed) return Conflict(new ProblemDetails { Status = 409, Title = "A consulta mudou ou já não permite preparar este fecho." });
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
        var allowed = await consultations.ReadAsync(data => data.Consultations.Any(c => c.Id == id && c.PhotoIds.Contains(photoId)
            && (Roles.IsManager(account.Role) || c.State == "Performed" && c.PersonId == account.PersonId)), ct);
        if (!allowed) return NotFound();
        var photo = await photos.ReadAsync(id, photoId, ct);
        return File(photo.Bytes, photo.ContentType, enableRangeProcessing: false);
    }
}
