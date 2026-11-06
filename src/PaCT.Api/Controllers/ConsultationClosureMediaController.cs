using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;
using PaCT.Api.Sharing;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/consultations/{id:guid}/closure-media/{scope}/{mediaId:guid}"), Authorize(Roles = Roles.ManagersAndClient)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ConsultationClosureMediaController(IConsultationStore store, IIdentityStore accounts, ClosureMediaStore files, SharingMedia media, TimeProvider time) : ControllerBase
{
    [Authorize(Roles = Roles.Managers), HttpPost, EnableRateLimiting("upload"),
     RequestSizeLimit(ClosureMediaStore.RequestLimit), RequestFormLimits(MultipartBodyLengthLimit = SharingMedia.VideoLimit)]
    public async Task<IActionResult> Upload(Guid id, string scope, Guid mediaId, [FromForm] long version, CancellationToken ct)
    {
        if (!ClosureMediaStore.ValidScope(scope)) return NotFound();
        var allowed = await store.ReadAsync(data => data.Consultations.Any(c => c.Id == id.ToString("D")
            && c.Version == version && ProcessLifecycle.Substate(c, time.GetUtcNow()) == "AwaitingClosure"), ct);
        if (!allowed) throw new IdentityProblem(409, "A consulta mudou ou já não permite preparar o fecho.");
        var uploads = (await Request.ReadFormAsync(ct)).Files;
        if (uploads.Count != 1 || uploads[0].Name is not ("images" or "video" or "audio"))
            throw new IdentityProblem(400, "Seleciona um ficheiro para anexar.");
        var upload = await media.ReadAsync(uploads[0], ct);
        await files.SaveAsync(id, scope, mediaId, User.FindFirstValue(ClaimTypes.NameIdentifier)!, upload, ct);
        return Ok(new { id = mediaId, confirmed = true });
    }

    [HttpGet]
    public async Task<IActionResult> Read(Guid id, string scope, Guid mediaId, CancellationToken ct)
    {
        if (!ClosureMediaStore.ValidScope(scope)) return NotFound();
        var account = await accounts.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, ct);
        if (account is null) return Unauthorized();
        var actor = new ConsultationActor(account.Id, account.PersonId, Roles.IsManager(account.Role));
        if (scope == "private" && !actor.IsManager) return NotFound();
        var reference = await store.ReadAsync(data => data.Consultations.SingleOrDefault(c => c.Id == id.ToString("D")) is { } c
            ? ClosureMediaStore.VisibleReference(c, scope, mediaId.ToString("D"), actor) : null, ct);
        if (reference is null) return NotFound();
        var file = await files.ReadAsync(id, scope, mediaId, ct);
        return File(file.Bytes, file.Type, enableRangeProcessing: reference.Kind is "video" or "audio");
    }
}
