using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PaCT.Api.Clients;
using PaCT.Api.Identity;
using PaCT.Api.Management;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/management/presentation"), Authorize(Roles = Roles.Managers)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(250000)]
public sealed class SitePresentationController(MySqlSitePresentationStore store) : ControllerBase
{
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);
    private string Author => User.FindFirstValue(ClaimTypes.NameIdentifier)!;

    [HttpGet("{section}")]
    public Task<SiteEditorView> Read(string section, CancellationToken ct) => store.ReadAsync(section, ct);

    [HttpPost("editor")]
    public async Task<IActionResult> Editor(SiteEditSession input, CancellationToken ct)
    {
        await store.EditAsync(input with { Editor = EditorId(input.Editor) }, Author, ct);
        return Ok(new { reserved = !input.Release });
    }

    [HttpPost("{section}/publish"), Consumes("application/json")]
    public Task<SitePublicationResult> Publish(string section, SitePublishInput input, CancellationToken ct)
    {
        var operation = ClientCommands.Key(Request) ?? throw new IdentityProblem(400, "Falta a identificação da publicação.");
        return store.PublishAsync(section, input with { Editor = EditorId(input.Editor) }, Author, operation, ct);
    }

    [HttpPost("{section}/publish"), Consumes("multipart/form-data"), RequestSizeLimit(SitePresentationImages.RequestLimit),
     RequestFormLimits(MultipartBodyLengthLimit = SitePresentationImages.MaximumBytes, ValueLengthLimit = 250000)]
    public async Task<SitePublicationResult> PublishTherapist(string section, [FromForm] string publication, CancellationToken ct)
    {
        if (section != "Therapist") throw new IdentityProblem(400, "Esta secção não aceita imagens.");
        var operation = ClientCommands.Key(Request) ?? throw new IdentityProblem(400, "Falta a identificação da publicação.");
        SitePublishInput? input;
        try { input = JsonSerializer.Deserialize<SitePublishInput>(publication, WebJson); }
        catch (JsonException) { throw InvalidPublication(); }
        if (input is null) throw InvalidPublication();
        input = input with { Editor = EditorId(input.Editor) };
        var form = await Request.ReadFormAsync(ct);
        var uploads = await SitePresentationImages.PrepareAsync(form.Files, ct);
        return await store.PublishTherapistAsync(input, uploads, Author, operation, ct);
    }

    private static IdentityProblem InvalidPublication() => new(400, "Revê os dados da publicação.");

    private static string EditorId(string? id) => Guid.TryParseExact(id, "D", out var editor) && editor != Guid.Empty
        ? editor.ToString("D") : throw new IdentityProblem(400, "Falta a identificação da janela de edição.");
}
