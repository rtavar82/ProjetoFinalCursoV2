using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PaCT.Api.Clients;
using PaCT.Api.Identity;
using PaCT.Api.Management;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/management/presentation"), Authorize(Roles = Roles.Managers)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(150000)]
public sealed class SitePresentationController(MySqlSitePresentationStore store) : ControllerBase
{
    private string Author => User.FindFirstValue(ClaimTypes.NameIdentifier)!;

    [HttpGet("{section}")]
    public Task<SiteEditorView> Read(string section, CancellationToken ct) => store.ReadAsync(section, ct);

    [HttpPost("editor")]
    public async Task<IActionResult> Editor(SiteEditSession input, CancellationToken ct)
    {
        await store.EditAsync(input with { Editor = EditorId(input.Editor) }, Author, ct);
        return Ok(new { reserved = !input.Release });
    }

    [HttpPost("{section}/publish")]
    public Task<SitePublicationResult> Publish(string section, SitePublishInput input, CancellationToken ct)
    {
        var operation = ClientCommands.Key(Request) ?? throw new IdentityProblem(400, "Falta a identificação da publicação.");
        return store.PublishAsync(section, input with { Editor = EditorId(input.Editor) }, Author, operation, ct);
    }

    private static string EditorId(string? id) => Guid.TryParseExact(id, "D", out var editor) && editor != Guid.Empty
        ? editor.ToString("D") : throw new IdentityProblem(400, "Falta a identificação da janela de edição.");
}
