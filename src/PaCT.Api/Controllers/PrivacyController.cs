using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using PaCT.Api.Identity;
using PaCT.Api.Management;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/privacy"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PrivacyController(PrivacyStore store) : ControllerBase
{
    private string Account => User.FindFirstValue(ClaimTypes.NameIdentifier)!;

    [AllowAnonymous, HttpGet]
    public async Task<IActionResult> Published(CancellationToken ct) => Ok(new { policy = await store.PublishedAsync(ct) });

    [Authorize(Roles = Roles.Client), HttpGet("choices")]
    public Task<PrivacyChoice[]> Choices(CancellationToken ct) => store.ChoicesAsync(Account, ct);

    [Authorize(Roles = Roles.Client), HttpPost("choices"), EnableRateLimiting("write"), RequestSizeLimit(4096)]
    public Task<PrivacyChoice> Decide(PrivacyChoiceInput input, CancellationToken ct) => store.DecideAsync(Account, input, ct);

    [Authorize(Roles = Roles.TechnicalManager), HttpGet("editor")]
    public Task<PrivacyEditor> Editor(int page = 1, CancellationToken ct = default) => page is >= 1 and <= 100000
        ? store.EditorAsync(page, ct) : throw new IdentityProblem(400, "A página pedida não é válida.");

    [Authorize(Roles = Roles.TechnicalManager), HttpGet("editor/versions/{version:long:min(1)}")]
    public Task<PrivacyPublication> Version(long version, CancellationToken ct) => store.ReadVersionAsync(version, ct);

    [Authorize(Roles = Roles.TechnicalManager), HttpPost("editor/draft"), EnableRateLimiting("write"), RequestSizeLimit(150000)]
    public async Task<IActionResult> Draft(PrivacyDraftInput input, CancellationToken ct) =>
        Ok(new { revision = await store.SaveAsync(input, Account, ct) });

    [Authorize(Roles = Roles.TechnicalManager), HttpPost("editor/publish"), EnableRateLimiting("write"), RequestSizeLimit(4096)]
    public async Task<IActionResult> Publish(PublishPrivacy input, CancellationToken ct)
    {
        var result = await store.PublishAsync(input.Revision, Account, ct);
        return result.Publication is { } publication ? Ok(publication) : Problem(statusCode: result.Status, title: result.Message);
    }
}

public sealed record PublishPrivacy(long Revision);
