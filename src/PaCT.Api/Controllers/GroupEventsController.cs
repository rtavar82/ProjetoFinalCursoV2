using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/consultations/events")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(16384)]
public sealed class GroupEventsController(IConsultationStore store, IIdentityStore accounts, IdentitySecurity security, TimeProvider time) : ControllerBase
{
    private async Task<IdentityAccount?> Account(CancellationToken ct) => User.Identity?.IsAuthenticated == true ? await accounts.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, ct) : null;
    [HttpGet, AllowAnonymous]
    public async Task<IActionResult> List(int page = 1, bool history = false, string? serviceId = null, CancellationToken ct = default)
    {
        var account = await Account(ct); var manager = Roles.IsManager(account?.Role); var now = time.GetUtcNow();
        if (history && !manager) return Forbid();
        if (page is < 1 or > 100000) return Problem(statusCode: 400, title: "Página inválida.");
        if (serviceId is not null && !Guid.TryParse(serviceId, out _)) return Problem(statusCode: 400, title: "Serviço inválido.");
        return Ok(await store.ReadEventCatalogueAsync(data =>
        {
            var rows = data.Events.Where(e => manager || e.Definition.Published)
                .Where(e => serviceId is null || e.Service.Id == serviceId)
                .Where(e => history || e.Definition.EndsAt > now && e.Definition.StartsAt < AgendaRules.HorizonEndExclusive(now))
                .OrderBy(e => e.Definition.StartsAt).ThenBy(e => e.Id).ToArray();
            return new { total = rows.Length, page, pageSize = 8, items = rows.Skip((page - 1) * 8).Take(8).Select(e => Public(e, data, account)).ToArray() };
        }, ct));
    }
    [HttpGet("{id:guid}"), Authorize(Roles = Roles.ManagersAndClient)]
    public async Task<IActionResult> Detail(string id, CancellationToken ct)
    {
        var account = await Account(ct) ?? throw new IdentityProblem(401, "Inicia sessão novamente."); var manager = Roles.IsManager(account.Role);
        return Ok(await store.ReadAsync(data =>
        {
            var e = data.Events.SingleOrDefault(e => e.Id == id && (manager || e.Definition.Published || data.Participations.Any(p => p.EventId == e.Id && p.PersonId == account.PersonId))) ?? throw new IdentityProblem(404, "Evento não encontrado.");
            return new { summary = Public(e, data, account), definition = manager ? e.Definition : null, e.ActualStartsAt, e.ActualEndsAt,
                balance = manager ? (decimal?)null : data.Balance(account.PersonId),
                paymentConditions = e.Service.ServiceKind == "Group" ? GroupPaymentConditions.Describe(e) : null,
                instructions = manager || data.Participations.Any(p => p.EventId == e.Id && p.PersonId == account.PersonId && p.State == "Confirmed") ? e.Service.Instructions : null,
                ownParticipations = !manager ? data.Participations.Where(p => p.EventId == e.Id && p.PersonId == account.PersonId).Select(p => Participation(p, data, false)).ToArray() : [],
                history = manager ? e.History ?? [] : [], e.KeepBlocked,
                protectedSeats = manager ? data.Participations.Where(p => p.EventId == e.Id && p.ProtectedSeat).Select(p => new { p.Id, p.PersonId }).ToArray() : [] };
        }, ct));
    }
    [HttpGet("{id:guid}/participants/{participationId:guid}"), Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> Participant(string id, string participationId, CancellationToken ct) => Ok(await store.ReadAsync(data =>
        Participation(data.Participations.SingleOrDefault(p => p.EventId == id && p.Id == participationId) ?? throw new IdentityProblem(404, "Inscrição não encontrada."), data, true), ct));
    [HttpGet("{id:guid}/participants"), Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> Participants(string id, int page = 1, CancellationToken ct = default)
    {
        if (page is < 1 or > 100000) return Problem(statusCode: 400, title: "Página inválida.");
        return Ok(await store.ReadAsync(data =>
        {
            if (!data.Events.Any(e => e.Id == id)) throw new IdentityProblem(404, "Evento não encontrado.");
            var rows = data.Participations.Where(p => p.EventId == id).OrderBy(p => p.CreatedAt).ThenBy(p => p.Id).ToArray();
            return new { total = rows.Length, page, pageSize = 8, items = rows.Skip((page - 1) * 8).Take(8).Select(p => Participation(p, data, true)).ToArray() };
        }, ct));
    }
    [HttpPost("{id:guid}/requests"), AllowAnonymous, EnableRateLimiting("guest-request")]
    public async Task<IActionResult> GuestRequest(string id, GuestSubmission input, CancellationToken ct)
    {
        if (User.Identity?.IsAuthenticated == true) throw new IdentityProblem(409, "Com sessão iniciada, faz a inscrição na tua área com a ficha autorizada.");
        return Ok(await store.SubmitEventGuestAsync(id, input, ct));
    }

    private object Public(GroupEvent e, ConsultationData data, IdentityAccount? account) => new
    {
        e.Id, e.Version, e.State, process = ProcessLifecycle.Status(e, time.GetUtcNow()), serviceId = e.Service.Id, title = e.Service.Title, kind = e.Service.ServiceKind,
        e.Definition.StartsAt, e.Definition.EndsAt, e.Definition.PublicLocation, e.Definition.Capacity, e.Definition.Published,
        e.Definition.Program, e.Definition.TotalPrice, e.Definition.CancellationConditions,
        remaining = e.State == "Scheduled" ? Math.Max(0, e.Definition.Capacity - GroupEvents.Seats(data, e.Id)) : 0, restricted = e.Definition.AllowedPersonIds is { Length: > 0 },
        eligible = account?.Role == Roles.Client && GroupEvents.Eligible(e, account.PersonId),
        e.Service.ReferencePrice, paymentMode = GroupPaymentConditions.Mode(e), isFree = GroupEvents.IsFree(e.Service),
        hasParticipation = account is not null && data.Participations.Any(p => p.EventId == e.Id && p.PersonId == account.PersonId && p.State is "Confirmed" or "Waiting")
    };
    private object Participation(EventParticipation p, ConsultationData data, bool manager) => new
    {
        process = ProcessLifecycle.Status(data.Events.Single(e => e.Id == p.EventId), p, time.GetUtcNow()), p.Id, p.EventId, p.PersonId, p.Version, p.State, p.ProtectedSeat, p.CreatedAt, p.Attendance, p.FinancialChoice, p.FinalAmount, p.SettlementId,
        p.ConfirmedAt, p.ConfirmedScheduleVersion, balance = p.PersonId is null ? 0 : data.Balance(p.PersonId),
        p.ArchivedAt, p.PublicContentVersion, p.ArchivedContentVersion,
        p.AcceptedAt, p.AcceptedTermsVersion, p.AcceptedConditions, p.ExpectationOpen, p.AdvanceSatisfiedAt,
        referencePrice = data.Events.Single(e => e.Id == p.EventId).Service.ReferencePrice,
        canReceive = manager && (data.Events.Single(e => e.Id == p.EventId).Service.ServiceKind == "Retreat" ? RetreatFinance.CanReceive(data, p) : GroupPaymentConditions.CanReceive(data, data.Events.Single(e => e.Id == p.EventId), p)),
        section = ClientAgenda.Section(data, data.Events.Single(e => e.Id == p.EventId), p, time.GetUtcNow()),
        financialState = ClientAgenda.FinancialState(data, data.Events.Single(e => e.Id == p.EventId), p),
        p.AgreedTotal, p.SettledAmount, p.CreditProposals, applied = RetreatFinance.Applied(data, p), remaining = GroupEvents.AmountDue(data, p), p.ReturnDue,
        returned = RetreatFinance.Returned(p), p.Returns, p.CancellationBy,
        sharedSummary = p.Attendance == "Performed" && p.SharedSummaryCiphertext is not null ? Decrypt(p.Id, "event-shared", p.SharedSummaryCiphertext) : null,
        privateNote = manager && p.PrivateNoteCiphertext is not null ? Decrypt(p.Id, "event-private", p.PrivateNoteCiphertext) : null,
        guestContact = manager && p.GuestContactCiphertext is not null ? JsonSerializer.Deserialize<GuestContact>(Decrypt(p.Id, "event-contact", p.GuestContactCiphertext)) : null,
        history = manager ? (p.History ?? []).Select(h => new { h.Action, h.AuthorId, h.At, h.Amount,
            reason = h.ReasonCiphertext is null ? null : Decrypt(p.Id, "event-return-reason", h.ReasonCiphertext) }).ToArray() : []
    };
    private string Decrypt(string id, string field, string value) => security.Decrypt(id, "consultation-" + field, Convert.FromBase64String(value));
}
