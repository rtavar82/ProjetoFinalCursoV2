using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/consultations/guests")]
[RequestSizeLimit(8192), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class GuestConsultationsController(IConsultationStore store, IdentitySecurity security, TimeProvider time) : ControllerBase
{
    [HttpPost, AllowAnonymous, EnableRateLimiting("guest-request")]
    public async Task<IActionResult> Submit(GuestSubmission input, CancellationToken ct)
    {
        if (User.Identity?.IsAuthenticated == true) throw new IdentityProblem(409, "Com sessão iniciada, faz o agendamento na tua área com a ficha autorizada.");
        return Ok(await store.SubmitGuestAsync(input, ct));
    }

    [HttpGet, Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> List(int page = 1, bool history = false, CancellationToken ct = default)
    {
        if (page is < 1 or > 100000) return Problem(statusCode: 400, title: "Página inválida.");
        var now = time.GetUtcNow();
        return Ok(await store.ReadAsync(data =>
        {
            var rows = data.GuestRequests.Where(g => history != GuestConsultations.Occupies(g, now)).OrderBy(g => g.StartsAt).ThenBy(g => g.Id).ToArray();
            return new { total = rows.Length, page, pageSize = 8, items = rows.Skip((page - 1) * 8).Take(8).Select(g => View(g, now)).ToArray() };
        }, ct));
    }
    [HttpGet("{id:guid}"), Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> Detail(string id, CancellationToken ct) => Ok(await store.ReadAsync(data =>
        View(data.GuestRequests.SingleOrDefault(g => g.Id == id) ?? throw new IdentityProblem(404, "Pedido não encontrado."), time.GetUtcNow()), ct));

    private object View(GuestConsultationRequest request, DateTimeOffset now) => new
    {
        request.Id, request.Version, request.StartsAt, request.EndsAt, request.CreatedAt,
        serviceTitle = request.Service.Title, request.Service.Modality, request.Service.PublicLocation,
        state = GuestConsultations.State(request, now), request.PersonId, request.ConsultationId,
        contact = JsonSerializer.Deserialize<GuestContact>(security.Decrypt(request.Id, "consultation-guest-contact", Convert.FromBase64String(request.ContactCiphertext))),
        history = request.History ?? []
    };
}
