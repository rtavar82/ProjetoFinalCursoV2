using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PaCT.Api.Clients;
using PaCT.Api.Identity;
using PaCT.Api.Management;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/management"), Authorize(Roles = Roles.Managers)]
[RequestSizeLimit(16384), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ManagementController(IManagementStore store, IIdentityStore accounts) : ControllerBase
{
    [HttpGet("{kind}")]
    public async Task<IActionResult> List(string kind, string? term = null, string status = "Active", int page = 1, CancellationToken ct = default)
        => Ok(await store.ListAsync(kind, term, status, page, ct));
    [HttpGet("{kind}/{id:guid}")]
    public async Task<IActionResult> Detail(string kind, string id, int historyPage = 1, CancellationToken ct = default)
    {
        var detail = await store.DetailAsync(kind, id.ToLowerInvariant(), historyPage, ct);
        var authors = new Dictionary<string, string>();
        foreach (var author in detail.History.Select(h => h.Entry.AuthorId).Distinct())
            authors[author] = author == "installation" ? "Preparação da aplicação" : (await accounts.FindAsync(author, ct))?.DisplayName ?? "Gestão";
        return Ok(detail with { Authors = authors });
    }
    [HttpPost("{kind}")]
    public Task<IActionResult> Create(string kind, DirectoryChange input, CancellationToken ct) => Change(kind, null, input, ct);
    [HttpPost("{kind}/{id:guid}")]
    public Task<IActionResult> Edit(string kind, string id, DirectoryChange input, CancellationToken ct) => Change(kind, id.ToLowerInvariant(), input, ct);
    private async Task<IActionResult> Change(string kind, string? id, DirectoryChange input, CancellationToken ct)
    {
        var operation = ClientCommands.Key(Request) ?? throw new IdentityProblem(400, "Falta a identificação da operação. Atualiza antes de tentar novamente.");
        return Ok(await store.ChangeAsync(kind, id, input, User.FindFirstValue(ClaimTypes.NameIdentifier)!, operation, ct));
    }
}
