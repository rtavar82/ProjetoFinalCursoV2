using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PaCT.Api.Clients;
using PaCT.Api.Consultations;
using PaCT.Api.Finance;
using PaCT.Api.Identity;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/finance/expenses"), Authorize(Roles = Roles.Managers)]
[RequestSizeLimit(8 * 1024 * 1024), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ExpensesController(IExpenseStore store, IIdentityStore accounts, IConsultationStore consultations) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(string section = "Unpaid", string? term = null, int page = 1, CancellationToken ct = default)
        => Ok(await store.ListAsync(section, term, page, ct));
    [HttpGet("activities")]
    public async Task<IActionResult> Activities(string kind = "Consultation", string? term = null, int page = 1, CancellationToken ct = default)
        => Ok(await consultations.ReadAgendaAsync(data => ExpenseActivities.Search(data, kind, term, page), ct));
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Detail(string id, int historyPage = 1, CancellationToken ct = default)
    {
        var detail = await store.DetailAsync(id.ToLowerInvariant(), historyPage, ct);
        var authors = new Dictionary<string, string>();
        foreach (var author in detail.History.Select(h => h.Expense.AuthorId).Concat(detail.Expense.Payments.Select(p => p.AuthorId)).Distinct())
            authors[author] = (await accounts.FindAsync(author, ct))?.DisplayName ?? "Gestão";
        return Ok(detail with { Authors = authors });
    }
    [HttpGet("{id:guid}/document")]
    public async Task<IActionResult> Document(string id, long? version, CancellationToken ct)
    {
        var file = await store.DocumentAsync(id.ToLowerInvariant(), version, ct);
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(file.Content, file.Document.ContentType, file.Document.Name);
    }
    [HttpPost]
    public Task<IActionResult> Create(ExpenseChange input, CancellationToken ct) => Change(null, input, ct);
    [HttpPost("{id:guid}")]
    public Task<IActionResult> Edit(string id, ExpenseChange input, CancellationToken ct) => Change(id.ToLowerInvariant(), input, ct);
    private async Task<IActionResult> Change(string? id, ExpenseChange input, CancellationToken ct)
    {
        var key = ClientCommands.Key(Request) ?? throw new IdentityProblem(400, "Falta a identificação da operação. Atualiza a página.");
        return Ok(await store.ChangeAsync(id, input, User.FindFirstValue(ClaimTypes.NameIdentifier)!, key, ct));
    }
}
