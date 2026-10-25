using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PaCT.Api.Clients;
using PaCT.Api.Identity;
using System.Security.Claims;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/clients"), Authorize(Roles = Roles.Managers)]
[RequestSizeLimit(32768), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ClientsController(ClientService clients) : ControllerBase
{
    private string Author => User.FindFirstValue(ClaimTypes.NameIdentifier)!;
    [HttpGet] public async Task<IActionResult> List(string field = "Name", string? term = null, int page = 1, CancellationToken ct = default) => Ok(await clients.SearchAsync(field, term, page, ct));
    [HttpGet("{id:guid}")] public async Task<IActionResult> Get(string id, CancellationToken ct) => Ok(await clients.GetAsync(id, ct));
    [HttpGet("names")] public async Task<IActionResult> Names([FromQuery] string[] ids, CancellationToken ct) => Ok(await clients.NamesAsync(ids, ct));
    [HttpPost] public Task<IActionResult> Create(ProfileChange input, CancellationToken ct) => Save(null, input, ct);
    [HttpPost("{id:guid}")] public Task<IActionResult> Edit(string id, ProfileChange input, CancellationToken ct) => Save(id, input, ct);
    private async Task<IActionResult> Save(string? id, ProfileChange input, CancellationToken ct)
    {
        if (IdentityValidation.MissingNameMessage(input.Data.FirstName, input.Data.LastName) is { } missingName)
            return Problem(statusCode: 400, title: missingName);
        if (!ClientValidation.HasContact(input.Data)) return Problem(statusCode: 400, title: ClientValidation.ContactRequiredMessage);
        return Ok(await clients.SaveAsync(id, input, Author, true, ct));
    }
    [HttpGet("reviews")] public async Task<IActionResult> Reviews(CancellationToken ct) => Ok(await clients.ReviewsAsync(null, true, ct));
    [HttpGet("reviews/summary")] public async Task<IActionResult> ReviewSummary(CancellationToken ct) => Ok(await clients.ReviewSummaryAsync(ct));
    [HttpPost("reviews/{id:guid}")] public async Task<IActionResult> Decide(string id, ReviewDecision input, CancellationToken ct) => Ok(await clients.DecideAsync(id, input, Author, ct));
    [Authorize(Roles = Roles.Managers), HttpGet("{id:guid}/notes")] public async Task<IActionResult> Notes(string id, int page = 1, CancellationToken ct = default) => Ok(await clients.NotesAsync(id, page, ct));
    [Authorize(Roles = Roles.Managers), HttpPost("{id:guid}/notes")] public async Task<IActionResult> AddNote(string id, NoteChange input, CancellationToken ct) => Ok(new { saved = await clients.SaveNoteAsync(id, null, input, Author, ct) });
    [Authorize(Roles = Roles.Managers), HttpPost("{id:guid}/notes/{noteId:guid}")] public async Task<IActionResult> EditNote(string id, string noteId, NoteChange input, CancellationToken ct) => Ok(new { saved = await clients.SaveNoteAsync(id, noteId, input, Author, ct) });
}

[ApiController, Route("api/profile"), Authorize(Roles = Roles.Client)]
[RequestSizeLimit(32768), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ClientProfileController(ClientService clients, IIdentityStore accounts) : ControllerBase
{
    private string Author => User.FindFirstValue(ClaimTypes.NameIdentifier)!;
    private async Task<string> Person(CancellationToken ct) => (await accounts.FindAsync(Author, ct))?.PersonId ?? throw new IdentityProblem(401, "Inicia sessão novamente.");
    [HttpGet] public async Task<IActionResult> Get(CancellationToken ct) => Ok(await clients.GetAsync(await Person(ct), ct));
    [HttpPost] public async Task<IActionResult> Edit(ProfileChange input, CancellationToken ct)
    {
        if (IdentityValidation.MissingNameMessage(input.Data.FirstName, input.Data.LastName) is { } missingName)
            return Problem(statusCode: 400, title: missingName);
        if (!ClientValidation.HasContact(input.Data)) return Problem(statusCode: 400, title: ClientValidation.ContactRequiredMessage);
        if (input.Data.BirthDate is null) return Problem(statusCode: 400, title: ClientValidation.BirthDateRequiredMessage);
        return Ok(await clients.SaveAsync(await Person(ct), input, Author, false, ct));
    }
    [HttpGet("reviews")] public async Task<IActionResult> Reviews(CancellationToken ct) => Ok(await clients.ReviewsAsync(await Person(ct), false, ct));
}
