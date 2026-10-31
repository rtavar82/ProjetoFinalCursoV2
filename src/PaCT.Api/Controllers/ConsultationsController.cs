using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;
using PaCT.Api.Clients;
using System.Security.Claims;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/consultations"), Authorize(Roles = Roles.ManagersAndClient)]
[RequestSizeLimit(65536), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ConsultationsController(IConsultationStore store, IIdentityStore accounts, IdentitySecurity security, TimeProvider time, IClientStore clients) : ControllerBase
{
    private async Task<ConsultationActor> Actor(CancellationToken ct)
    {
        var account = await accounts.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, ct) ?? throw new IdentityProblem(401, "Inicia sessão novamente.");
        if (!Roles.IsManager(account.Role) && account.Role != Roles.Client) throw new IdentityProblem(403, "Esta área não está disponível para esta conta.");
        return new(account.Id, account.PersonId, Roles.IsManager(account.Role));
    }
    [AllowAnonymous, HttpGet("availability")]
    public async Task<IActionResult> Availability(CancellationToken ct)
    {
        var now = time.GetUtcNow(); var horizon = AgendaRules.HorizonEndExclusive(now);
        var registered = User.Identity?.IsAuthenticated == true;
        return Ok(await store.ReadAgendaAsync(data => new
        {
            services = ActivityCatalogue.Complete(data.Services).Where(s => s.Active).Select(PublicService).ToArray(),
            windows = AgendaRules.ActiveWindows(data).Where(w => w.EndsAt > now && w.StartsAt < horizon && (!w.Available || AgendaRules.EligibleWindow(w, registered))).OrderBy(w => w.StartsAt)
                .Select(w => new { w.Id, w.StartsAt, w.EndsAt, w.Available, w.Version, w.Rules }).ToArray(),
            occupied = data.Consultations.Where(c => c.EndsAt.AddMinutes(30) > now && c.StartsAt < horizon && ConsultationRules.Occupies(c, now))
                .Select(c => new { c.StartsAt, endsAt = c.EndsAt.AddMinutes(30) })
                .Concat(data.GuestRequests.Where(g => GuestConsultations.Occupies(g, now) && g.EndsAt.AddMinutes(30) > now && g.StartsAt < horizon)
                    .Select(g => new { g.StartsAt, endsAt = g.EndsAt.AddMinutes(30) }))
                .Concat(data.Events.Where(e => GroupEvents.Occupies(e) && e.Definition.EndsAt.AddMinutes(30) > now && e.Definition.StartsAt < horizon)
                    .Select(e => new { e.Definition.StartsAt, endsAt = e.Definition.EndsAt.AddMinutes(30) })).ToArray(),
            serverTime = now, horizonEndExclusive = horizon
        }, ct));
    }
    [AllowAnonymous, HttpGet("calendar")]
    public async Task<IActionResult> Calendar(string? month, CancellationToken ct)
    {
        var now = time.GetUtcNow(); var range = AgendaRules.MonthRange(month, now);
        var account = User.Identity?.IsAuthenticated == true ? await accounts.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, ct) : null;
        var registered = account is not null;
        return Ok(await store.ReadAgendaAsync(data => new
        {
            timeZone = "Europe/Lisbon", startsAt = range.Start, endsAt = range.End, horizonEndExclusive = AgendaRules.HorizonEndExclusive(now),
            services = ActivityCatalogue.Complete(data.Services).Where(s => s.Active).Concat(data.Events.Where(e => e.Definition.Published && e.Definition.EndsAt > range.Start && e.Definition.StartsAt < range.End).Select(e => e.Service)).DistinctBy(s => s.Id).Select(PublicService).ToArray(),
            events = data.Events.Where(e => e.Definition.Published && e.Definition.EndsAt > range.Start && e.Definition.StartsAt < range.End)
                .OrderBy(e => e.Definition.StartsAt).ThenBy(e => e.Id).Select(e => new { e.Id, e.Version, e.State, process = ProcessLifecycle.Status(e, now),
                    serviceId = e.Service.Id, title = e.Service.Title, kind = e.Service.ServiceKind, modality = e.Service.Modality,
                    e.Definition.StartsAt, e.Definition.EndsAt, e.Definition.PublicLocation,
                    remaining = Math.Max(0, e.Definition.Capacity - GroupEvents.Seats(data, e.Id)),
                    eligible = account?.Role == Roles.Client && GroupEvents.Eligible(e, account.PersonId) }).ToArray(),
            intervals = AgendaRules.PublicSegments(data, range.Start, range.End, now, registered),
            bookingIntervals = AgendaRules.PublicSegments(data, range.Start, range.End.AddHours(13), now, registered),
            bookingWindows = AgendaRules.ActiveWindows(data).Where(w => w.Available && AgendaRules.EligibleWindow(w, registered) && w.EndsAt > range.Start && w.StartsAt < range.End)
                .Select(w => new { w.StartsAt, w.EndsAt, w.Rules }).ToArray(), serverTime = now
        }, ct));
    }
    private static object PublicService(ConsultationService s) => new { s.Id, s.Version, s.Title, s.DurationMinutes, s.ReferencePrice, s.PaymentMode, s.Modality,
        publicLocation = s.Modality == "Remote" ? "" : s.PublicLocation, s.ServiceKind, s.DefinedPerEvent,
        bookingOptions = s.ServiceKind is null ? ClientBooking.Options(s).Select(o => new { o.Id, o.Modality, o.PublicLocation,
            ClientBooking.Snapshot(s, o).DurationMinutes, ClientBooking.Snapshot(s, o).ReferencePrice, ClientBooking.Snapshot(s, o).PaymentMode }).ToArray() : null };
    [HttpPost("booking-preview"), Authorize(Roles = Roles.Client)]
    public async Task<IActionResult> BookingPreview(BookingPreviewInput input, CancellationToken ct)
    {
        _ = await Actor(ct); var now = time.GetUtcNow();
        if (input.ServiceVersion < 1) throw new IdentityProblem(400, "Revê as opções atuais da consulta.");
        return Ok(await store.ReadAgendaAsync(data =>
        {
            var service = ClientBooking.Validate(data, input.ServiceId, input.StartsAt.ToUniversalTime(), input.ServiceVersion, input.DeliveryOptionId, now);
            return new { serviceId = service.Id, serviceVersion = service.Version, service.Title, service.Modality, service.PublicLocation,
                service.DurationMinutes, service.ReferencePrice, service.PaymentMode, startsAt = input.StartsAt.ToUniversalTime(),
                endsAt = input.StartsAt.ToUniversalTime().AddMinutes(service.DurationMinutes), serverTime = now };
        }, ct));
    }
    [HttpPost("availability/preview"), Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> PreviewAvailability(AvailabilityPublication input, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        return Ok(await store.ReadAgendaAsync(data => AgendaRules.Preview(data, input, now), ct));
    }
    [HttpPost("manual-preview"), Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> PreviewManual(ManualBookingInput input, CancellationToken ct)
    {
        var actor = await Actor(ct);
        if (!actor.IsManager) return Forbid();
        var eligible = await clients.ExecuteAsync(async session =>
        {
            var person = (await session.ClientsAsync()).SingleOrDefault(p => p.Id == input.PersonId);
            return person is { IsActive: true } && person.IdentityReviewStatus != "Pending"
                && !(await session.ReviewsAsync()).Any(r => r.PersonId == input.PersonId && r.Kind == "Registration" && r.Status == "Open");
        }, false, ct);
        if (!eligible) throw new IdentityProblem(409, "A ficha não está disponível para uma marcação. Revê a identidade em Clientes.");
        var now = time.GetUtcNow();
        return Ok(await store.ReadAsync(data => ManualBooking.Preview(data, input, now), ct));
    }
    [HttpGet("management"), Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> Management(string section = "Upcoming", int page = 1,
        DateTimeOffset? from = null, DateTimeOffset? to = null, CancellationToken ct = default)
    {
        var actor = await Actor(ct);
        if (!actor.IsManager) return Forbid();
        var now = time.GetUtcNow();
        return Ok(await store.ReadAsync(data => ManagementAgenda.Read(data, section, page, now, from, to), ct));
    }

    [HttpGet]
    public async Task<IActionResult> List(string? section = null, int page = 1, bool search = false, string? personId = null,
        string? state = null, string? financial = null, DateTimeOffset? from = null, DateTimeOffset? to = null,
        string? sort = null, bool? hasNotes = null, bool? seen = null, CancellationToken ct = default, string? serviceId = null)
    {
        var actor = await Actor(ct);
        var now = time.GetUtcNow();
        section ??= actor.IsManager ? "Requests" : "Upcoming";
        string[] sections = actor.IsManager ? ["Requests", "AwaitingReceipt", "Upcoming", "Ended", "Closure", "Performed", "NoShow", "Cancelled"] : ["Payments", "Closed", "Upcoming", "Other", "Followup"];
        if (page is < 1 or > 100000 || from is not null && to is not null && from >= to || !sections.Contains(section) || seen is not null && (actor.IsManager || section is not ("Followup" or "Closed"))
            || personId is not null && !Guid.TryParse(personId, out _) || sort is not (null or "Oldest" or "Newest")
            || state is not (null or "Requested" or "Confirmed" or "AwaitingClosure" or "Performed" or "NoShow" or "CancelledClient" or "CancelledManager" or "Expired" or "Rejected" or "Scheduled" or "Waiting" or "Cancelled")
            || serviceId is not null && (actor.IsManager || !Guid.TryParse(serviceId, out _))
            || financial is not (null or "CollectionClosed" or "ConditionsPending" or "AwaitingReceipt" or "Paid" or "NoDebt" or "Unpaid" or "ContributionUndefined" or "ContributionPending"))
            return Problem(statusCode: 400, title: "Página, período ou filtros inválidos.");
        return Ok(await store.ReadAsync(data =>
        {
            if (!actor.IsManager)
            {
                var result = ClientAgenda.Read(data, actor.PersonId, section, page, now,
                    new(search, state, financial, from, to, sort, hasNotes, seen, personId, serviceId));
                var ownDebt = data.Consultations.Where(c => c.PersonId == actor.PersonId && ConsultationRules.HasDebt(c)).ToArray();
                var participations = data.Participations.Where(p => p.PersonId == actor.PersonId).ToArray();
                var otherDebt = data.Packs.Where(p => p.PersonId == actor.PersonId && p.SettlementId is null).Sum(p => p.Amount)
                    + participations.Sum(p => GroupEvents.AmountDue(data, p));
                return (object)new { total = result.Total, page, pageSize = 8,
                    items = result.Items.Select(row => row.Consultation is { } c ? View(c, data, actor, now) : row.Guest is { } g ? GuestView(g, data, now) : ParticipationView(row, data)).ToArray(),
                    globalDebt = Math.Max(0, -data.Balance(actor.PersonId)), balance = data.Balance(actor.PersonId),
                    totalDebt = ownDebt.Sum(ConsultationRules.Remaining) + otherDebt + Math.Max(0, -data.Balance(actor.PersonId)),
                    undefinedDebt = ownDebt.Any(c => c.FinalAmount is null) || participations.Any(ClientAgenda.UndefinedDebt),
                    totalSeen = result.TotalSeen, totalUnseen = result.TotalUnseen,
                    searchServices = ActivityCatalogue.Complete(data.Services).Where(s => s.Active)
                        .Concat(data.Consultations.Where(c => c.PersonId == actor.PersonId).Select(c => c.Service))
                        .Concat(data.Participations.Where(p => p.PersonId == actor.PersonId).Select(p => data.Events.Single(e => e.Id == p.EventId).Service))
                        .Concat(data.GuestRequests.Where(g => g.PersonId == actor.PersonId && g.State != "Linked").Select(g => g.Service))
                        .DistinctBy(s => s.Id).OrderBy(s => s.Title).Select(s => new { s.Id, s.Title }).ToArray(), serverTime = now };
            }
            if (search)
            {
                var result = ManagementAgenda.Search(data, page, now, new(Search: true, State: state, Financial: financial, From: from, To: to,
                    Sort: sort ?? (section is "Performed" or "NoShow" or "Cancelled" or "Ended" ? "Newest" : "Oldest"), HasNotes: hasNotes, PersonId: personId));
                return (object)new { result.Total, page, pageSize = 8,
                    items = result.Items.Select(row => row.Kind == "Consultation" ? View(data.Consultations.Single(c => c.Id == row.Id), data, actor, now) : (object)row).ToArray(), globalDebt = 0,
                    balance = (decimal?)null, totalDebt = (decimal?)null, undefinedDebt = false, totalSeen = 0, totalUnseen = result.Total, serverTime = now };
            }
            var rows = data.Consultations.Where(c => actor.IsManager || c.PersonId == actor.PersonId)
                .Where(c => section == "Followup" ? c.State == "Performed" && ConsultationRules.ClientSection(c, now) == "Closed" : search || (actor.IsManager ? ConsultationRules.ManagerSection(c, now) : ConsultationRules.ClientSection(c, now)) == section)
                .Where(c => personId is null || c.PersonId == personId)
                .Where(c => state is null || ProcessLifecycle.Substate(c, now) == state)
                .Where(c => financial is null || (financial == "CollectionClosed" ? c.CollectionClosed : ConsultationRules.FinancialState(c) == financial))
                .Where(c => (from is null || c.StartsAt >= from) && (to is null || c.StartsAt < to))
                .Where(c => hasNotes is null || hasNotes == (c.SharedNoteCiphertext is not null || actor.IsManager && c.PrivateNoteCiphertext is not null));
            bool WasSeen(Consultation c) => c.ArchivedAt is not null && (c.ArchivedContentVersion ?? 1) == c.PublicContentVersion;
            var counts = rows.ToArray();
            rows = counts.Where(c => seen is null || WasSeen(c) == seen);
            var descending = sort == "Newest" || sort is null && section is "Performed" or "NoShow" or "Cancelled" or "Ended" or "Closed" or "Followup";
            DateTimeOffset Date(Consultation c) => section == "Ended" && !search ? c.CancelledAt ?? c.StartsAt : c.StartsAt;
            var ordered = (descending ? rows.OrderByDescending(Date) : rows.OrderBy(Date)).ThenBy(c => c.Id).ToArray();
            return (object)new { total = ordered.Length, page, pageSize = 8, items = ordered.Skip((page - 1) * 8).Take(8).Select(c => View(c, data, actor, now)).ToArray(), globalDebt = 0,
                balance = (decimal?)null, totalDebt = (decimal?)null, undefinedDebt = false,
                totalSeen = counts.Count(WasSeen), totalUnseen = counts.Count(c => !WasSeen(c)), serverTime = now };
        }, ct));
    }
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Detail(string id, CancellationToken ct)
    {
        var actor = await Actor(ct);
        var now = time.GetUtcNow();
        return Ok(await store.ReadAsync(data =>
        {
            var consultation = data.Consultations.SingleOrDefault(c => c.Id == id && (actor.IsManager || c.PersonId == actor.PersonId));
            if (consultation is not null) return View(consultation, data, actor, now);
            if (!actor.IsManager && data.GuestRequests.SingleOrDefault(g => g.Id == id && g.PersonId == actor.PersonId) is { } guest)
            {
                // An already open request keeps working when management approves it.
                if (guest.State == "Linked" && data.Consultations.SingleOrDefault(c => c.Id == guest.ConsultationId && c.PersonId == actor.PersonId) is { } approved)
                    return View(approved, data, actor, now);
                if (guest.State != "Linked") return GuestView(guest, data, now);
            }
            throw new IdentityProblem(404, "Consulta não encontrada.");
        }, ct));
    }
    [HttpGet("setup"), Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> Setup(CancellationToken ct) => Ok(await store.ReadAgendaAsync(data => new { services = ActivityCatalogue.Complete(data.Services), windows = AgendaRules.ActiveWindows(data).ToArray(), revision = AgendaRules.Revision(data) }, ct));
    [HttpGet("{id:guid}/messages")]
    public async Task<IActionResult> Messages(string id, long? before, CancellationToken ct)
    {
        var actor = await Actor(ct);
        if (before is <= 0) return Problem(statusCode: 400, title: "Página de mensagens inválida.");
        var page = await store.ReadConversationAsync(id, actor, before, ct); var c = page.Consultation;
        return Ok(new
            {
                consultationId = c.Id, c.ConversationVersion, blocked = c.ConversationBlocked, pageSize = 20,
                unread = page.Unread, hasOlder = page.HasOlder, latestSequence = page.LatestSequence,
                items = page.Messages.Select(m => new { m.Id, m.Sequence, m.CreatedAt, own = m.AuthorIsManager == actor.IsManager,
                    author = m.AuthorIsManager == actor.IsManager ? "Tu" : m.AuthorIsManager ? "Terapeuta" : "Cliente",
                    text = Decrypt(m.Id, "message", m.TextCiphertext), photoIds = m.PhotoIds ?? [], unread = m.AuthorIsManager != actor.IsManager && !page.ReadIds.Contains(m.Id) }).ToArray()
            });
    }
    [HttpGet("finance")]
    public async Task<IActionResult> Finance(string? personId, string section = "Pending", int page = 1, string? term = null,
        string? sort = null, DateTimeOffset? from = null, DateTimeOffset? to = null, CancellationToken ct = default)
    {
        var actor = await Actor(ct); var person = actor.IsManager ? personId : actor.PersonId; var now = time.GetUtcNow();
        if (section is not ("Pending" or "Balances" or "Corrections") || section == "Corrections" && !actor.IsManager) return Problem(statusCode: 403, title: "Área financeira indisponível.");
        if (page is < 1 or > 100000 || person is not null && !Guid.TryParse(person, out _) || term?.Length > 256 || from is not null && to is not null && from >= to) return Problem(statusCode: 400, title: "Pesquisa inválida.");
        var names = actor.IsManager ? await Names(ct) : new Dictionary<string, FinancePerson> { [actor.PersonId] = new("A minha ficha", true) };
        return Ok(await store.ReadAsync(data =>
        {
            bool Matches(string id) => (person is null || id == person) && (string.IsNullOrWhiteSpace(term) || (names.GetValueOrDefault(id)?.Name ?? "").Contains(term, StringComparison.OrdinalIgnoreCase));
            var obligations = data.Consultations.Where(c => Matches(c.PersonId) && ConsultationRules.ActiveObligation(c))
                .Where(c => (from is null || c.StartsAt >= from) && (to is null || c.StartsAt < to));
            var ordered = (sort == "Newest" ? obligations.OrderByDescending(c => c.StartsAt)
                : sort == "Oldest" ? obligations.OrderBy(c => c.StartsAt)
                : obligations.OrderBy(c => ConsultationRules.HasDebt(c) ? 0 : 1).ThenBy(c => c.StartsAt)).ThenBy(c => c.Id).ToArray();
            var people = names.Where(n => Matches(n.Key) && (n.Value.Active || data.Entries.Any(e => e.PersonId == n.Key) || data.Consultations.Any(c => c.PersonId == n.Key)));
            var nameComparer = StringComparer.Create(System.Globalization.CultureInfo.GetCultureInfo("pt-PT"), true);
            var balances = (sort == "NameDescending" ? people.OrderByDescending(n => n.Value.Name, nameComparer) : people.OrderBy(n => n.Value.Name, nameComparer)).ThenBy(n => n.Key).ToArray();
            var movementRows = data.Entries.Where(e => Matches(e.PersonId) && (section == "Corrections" ? e.Kind is "Adjustment" or "AdjustmentReversal" : person is not null)
                && (from is null || e.CreatedAt >= from) && (to is null || e.CreatedAt < to));
            var entries = (sort == "Oldest" ? movementRows.OrderBy(e => e.CreatedAt).ThenBy(e => e.Sequence) : movementRows.OrderByDescending(e => e.CreatedAt).ThenByDescending(e => e.Sequence)).ThenBy(e => e.Id).ToArray();
            var running = entries.Select(e => e.PersonId).Distinct().SelectMany(id => CreditLedger.RunningBalances(data, id)).ToDictionary(x => x.Key, x => x.Value);
            var negative = balances.Where(n => data.Balance(n.Key) < 0).ToArray();
            var additional = data.Packs.Where(p => Matches(p.PersonId) && p.SettlementId is null && (from is null || p.PurchasedAt >= from) && (to is null || p.PurchasedAt < to))
                .Select(p => new DomainObligation(p.Id, "Pack", p.PersonId, p.Title, p.Amount, p.PurchasedAt, p.Id))
                .Concat(data.Participations.Where(p => p.PersonId is not null && Matches(p.PersonId) && (GroupEvents.AmountDue(data, p) > 0 || ClientAgenda.UndefinedDebt(p)))
                    .Select(p => (P: p, E: data.Events.Single(e => e.Id == p.EventId)))
                    .Where(x => (from is null || x.E.Definition.StartsAt >= from) && (to is null || x.E.Definition.StartsAt < to))
                    .Select(x => new DomainObligation(x.P.Id, "Event", x.P.PersonId!, x.E.Service.Title, ClientAgenda.UndefinedDebt(x.P) ? null : GroupEvents.AmountDue(data, x.P), x.E.Definition.StartsAt, x.E.Id)))
                .OrderBy(p => p.StartsAt).ThenBy(p => p.Id).ToArray();
            var skip = (page - 1) * 8;
            return new { personId = person, balance = person is null ? (decimal?)null : data.Balance(person), page, pageSize = 8,
                total = section == "Pending" ? ordered.Length + negative.Length + additional.Length : section == "Corrections" ? entries.Length : person is null ? balances.Length : entries.Length,
                additionalObligations = section == "Pending" ? additional.Skip(Math.Max(0, skip - negative.Length - ordered.Length)).Take(Math.Max(0, 8 - Math.Clamp(negative.Length + ordered.Length - skip, 0, 8))).ToArray() : person is not null ? additional : [],
                globalDebts = section == "Pending" ? negative.Skip(skip).Take(8).Select(n => new { personId = n.Key, name = n.Value.Name, amount = -data.Balance(n.Key), noticeId = data.BalanceNotices.SingleOrDefault(x => x.PersonId == n.Key && x.ClosedAt is null)?.Id, pushState = data.BalanceNotices.SingleOrDefault(x => x.PersonId == n.Key && x.ClosedAt is null)?.PushState }).ToArray() : [],
                customers = section == "Balances" && person is null ? balances.Skip(skip).Take(8).Select(n => new { id = n.Key, name = n.Value.Name + (n.Value.Active ? "" : " (ficha inativa)"), balance = data.Balance(n.Key) }).ToArray() : [],
                entries = entries.Skip(skip).Take(8).Select(e => new { e.Id, e.PersonId, name = names.GetValueOrDefault(e.PersonId)?.Name,
                    e.ConsultationId, e.Kind, e.Amount, e.CreatedAt, effectiveAt = e.EffectiveAt ?? e.CreatedAt, e.OriginalId, e.Method, e.Origin, e.OriginReference, e.AuthorId,
                    resultingBalance = running[e.Id],
                    privateReason = actor.IsManager && e.ReasonCiphertext is not null ? Decrypt(e.Id, "reason", e.ReasonCiphertext) : null,
                    canReverse = actor.IsManager && e.Kind is "Receipt" or "Refund" && !data.Entries.Any(r => r.Kind == "Reversal" && r.OriginalId == e.Id),
                    canReverseAdjustment = actor.IsManager && e.Kind == "Adjustment" && !data.Entries.Any(r => r.Kind == "AdjustmentReversal" && r.OriginalId == e.Id) }).ToArray(),
                obligations = section == "Pending" ? ordered.Skip(Math.Max(0, skip - negative.Length)).Take(Math.Max(0, 8 - Math.Clamp(negative.Length - skip, 0, 8))).Select(c => View(c, data, actor, now)).ToArray() : [] };

        }, ct));
    }
    [HttpGet("reports"), Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> Reports(string? personId, DateTimeOffset? from, DateTimeOffset? to, string? origin, string? kind, CancellationToken ct)
    {
        if (from is not null && to is not null && from >= to) return Problem(statusCode: 400, title: "Período inválido.");
        return Ok(await store.ReadAsync(data => FinanceReports.Create(data, time.GetUtcNow(), personId, from, to, origin, kind), ct));
    }
    private sealed record FinancePerson(string Name, bool Active);
    private sealed record DomainObligation(string Id, string Kind, string PersonId, string Title, decimal? Amount, DateTimeOffset StartsAt, string ResourceId);
    private Task<Dictionary<string, FinancePerson>> Names(CancellationToken ct) => clients.ExecuteAsync(async session =>
        (await session.ClientsAsync()).ToDictionary(c => c.Id, c => new FinancePerson(string.Join(" ", new[] { "first-name", "last-name" }
            .Select(field => c.PrivateData.TryGetValue(field, out var value) ? security.Decrypt(c.Id, field, value) : "")).Trim(), c.IsActive)), false, ct);
    [HttpGet("notices")]
    public async Task<IActionResult> Notices(CancellationToken ct)
    {
        var actor = await Actor(ct);
        return Ok(await store.ReadAsync(data =>
        {
            var messageSequences = data.Messages.ToDictionary(m => "FollowupMessage:" + m.Id, m => m.Sequence);
            var consultationNotices = data.Notices.Where(n => (actor.IsManager ? n.PersonId is null : n.PersonId == actor.PersonId)
                && !n.Cancelled && n.ReadAt is null && n.DueAt <= time.GetUtcNow() && (n.ExpiresAt is null || n.ExpiresAt > time.GetUtcNow())
                && !data.Consultations.Any(c => ConsultationRules.ObsoleteAdvanceNotice(n, c)))
                .GroupBy(n => (n.ConsultationId, n.PersonId, Group: n.Kind.StartsWith("FollowupMessage:", StringComparison.Ordinal) ? "FollowupMessage" : n.Id))
                .Select(group => (Notice: group.OrderByDescending(n => messageSequences.GetValueOrDefault(n.Kind)).ThenByDescending(n => n.DueAt).First(), Count: group.Count()))
                .OrderBy(group => group.Notice.DueAt).Take(100).Select(group => NoticeView(group.Notice, data, actor.IsManager, group.Count));
            var balanceNotices = data.BalanceNotices.Where(n => n.ClosedAt is null && (actor.IsManager ? n.ManagerReadAt is null : n.PersonId == actor.PersonId && n.ClientReadAt is null))
                .Select(n => (object)new { n.Id, n.PersonId, consultationId = (string?)null, kind = "NegativeBalance", amount = Math.Max(0, -data.Balance(n.PersonId)), dueAt = n.CreatedAt });
            var guestNotices = actor.IsManager ? data.GuestRequests.Where(g => g.NoticeReadAt is null && GuestConsultations.Occupies(g, time.GetUtcNow()))
                .Select(g => (object)new { g.Id, guestRequestId = g.Id, consultationId = (string?)null, kind = "GuestRequest", dueAt = g.CreatedAt,
                    g.PersonId, serviceTitle = g.Service.Title, g.StartsAt, g.Service.PublicLocation, g.Service.Modality }) : [];
            var packNotices = data.PackNotices.Where(n => (actor.IsManager ? n.ManagerReadAt is null : n.PersonId == actor.PersonId && n.ReadAt is null && !n.Kind.StartsWith("PackManager:")) && !n.Cancelled && n.DueAt <= time.GetUtcNow() && n.ExpiresAt > time.GetUtcNow())
                .Select(n => { var pack = data.Packs.SingleOrDefault(p => p.Id == n.PackId); return (object)new { n.Id, n.PackId, kind = n.Kind.Split(':')[0], dueAt = n.DueAt,
                    personId = actor.IsManager ? pack?.PersonId : null, serviceTitle = actor.IsManager ? pack?.Title : null }; });
            var eventNotices = data.EventNotices.Where(n => (actor.IsManager ? n.PersonId is null : n.PersonId == actor.PersonId)
                && !n.Cancelled && n.ReadAt is null && n.DueAt <= time.GetUtcNow() && (n.ExpiresAt is null || n.ExpiresAt > time.GetUtcNow()))
                .Select(n => { var occurrence = actor.IsManager ? data.Events.SingleOrDefault(e => e.Id == n.EventId) : null;
                    var participant = actor.IsManager ? data.Participations.SingleOrDefault(p => p.Id == n.ParticipationId) : null;
                    return (object)new { n.Id, n.EventId, n.ParticipationId, n.Kind, n.DueAt, personId = participant?.PersonId,
                        serviceTitle = occurrence?.Service.Title, startsAt = occurrence?.Definition.StartsAt,
                        publicLocation = occurrence?.Definition.PublicLocation, modality = occurrence?.Service.Modality }; });
            return consultationNotices.Concat(balanceNotices).Concat(guestNotices).Concat(packNotices).Concat(eventNotices).ToArray();
        }, ct));
    }
    [HttpPost("commands"), EnableRateLimiting("write")]
    public async Task<IActionResult> Command(ConsultationCommand input, [FromServices] ConsultationPhotoStore photos, CancellationToken ct)
    {
        var actor = await Actor(ct);
        if (input.Action == "Close" && input.PhotoIds.Length > 0)
        {
            if (!actor.IsManager) return Forbid();
            await photos.ValidateClosureAsync(input, actor.AccountId, ct);
        }
        if (input.Action == "SendMessage" && input.PhotoIds is { Length: > 0 })
        {
            if (!actor.IsManager) return Forbid();
            await photos.ValidateMessageAsync(input, actor.AccountId, ct);
        }
        return Ok(await store.ExecuteAsync(input, actor, ct));
    }
    private object View(Consultation c, ConsultationData data, ConsultationActor actor, DateTimeOffset now) => new
    {
        kind = "Consultation", sourceId = c.Id, activityKind = "Individual",
        c.Id, c.PersonId, c.Version, serviceId = c.Service.Id, serviceTitle = c.Service.Title, c.StartsAt, c.EndsAt, c.Service.Modality, c.Service.PublicLocation,
        c.Service.ReferencePrice, c.Service.PaymentMode,
        instructions = actor.IsManager || c.ApprovedAt is not null && (c.FinancialChoice != "Prepayment" || c.AdvanceSatisfiedAt is not null)
            ? AppointmentCommunications.Instructions(c.Service.Modality, c.Service.PublicLocation, c.Service.Instructions) : null,
        c.FinancialChoice, c.CreatedAt,
        process = ProcessLifecycle.Status(c, now), state = ProcessLifecycle.Substate(c, now), financialState = ConsultationRules.FinancialState(c),
        section = actor.IsManager ? ConsultationRules.ManagerSection(c, now) : ConsultationRules.ClientSection(c, now),
        c.ExpectationOpen, c.ReceivedAmount, c.AcceptedAt, c.AcceptedTermsVersion, c.PaymentDeclaredAt, c.ClosedAt,
        c.AdvanceSatisfiedAt, c.AdvanceSatisfiedBalance, c.CollectionClosed,
        paymentAlert = data.Notices.Any(n => n.ConsultationId == c.Id && ConsultationRules.PaymentNoticeActive(n)),
        paymentCommunications = actor.IsManager ? c.PaymentCommunications : [],
        collectionHistory = actor.IsManager ? c.CollectionHistory.Select(h => new { h.Id, h.Closed, h.AuthorId, h.At, reason = h.ReasonCiphertext is null ? null : Decrypt(c.Id, "collection", h.ReasonCiphertext) }).ToArray() : [],
        actions = Actions(c, data, actor, now),
        c.FinalAmount, c.NoDebtReason, c.SettlementId, c.SettledAmount, amountDue = ConsultationRules.Remaining(c), c.CreditProposals, c.ArchivedAt, c.PublicContentVersion, c.ArchivedContentVersion, c.KeepBlocked, c.AvailabilityDecidedAt,
        c.CancellationOrigin, c.CancelledAt, c.ActualStartsAt, c.ActualEndsAt,
        balance = data.Balance(c.PersonId), termsVersion = ConsultationConditions.Version(c), terms = ConsultationConditions.Describe(c).Text,
        paymentConditions = ConsultationConditions.Describe(c), conditionsPending = ConsultationConditions.Pending(c, now),
        sharedNote = c.State == "Performed" && c.SharedNoteCiphertext is not null ? Decrypt(c.Id, "shared", c.SharedNoteCiphertext) : null,
        privateNote = actor.IsManager && c.PrivateNoteCiphertext is not null ? Decrypt(c.Id, "private", c.PrivateNoteCiphertext) : null,
        photoIds = c.State == "Performed" ? c.PhotoIds : [],
        unreadMessages = c.State == "Performed" ? data.Messages.Count(m => m.ConsultationId == c.Id && ConsultationConversation.Unread(data, m, actor)) : 0,
        serverTime = now
    };
    private static object GuestView(GuestConsultationRequest g, ConsultationData data, DateTimeOffset now) => new
    {
        g.Id, kind = "Guest", sourceId = g.Id, g.PersonId, g.Version, serviceId = g.Service.Id, serviceTitle = g.Service.Title,
        g.StartsAt, g.EndsAt, g.Service.Modality, g.Service.PublicLocation, g.Service.ReferencePrice, g.Service.PaymentMode,
        process = ProcessLifecycle.Status(g, now), state = ProcessLifecycle.Substate(g, now) == "InTreatment" ? "Requested" : ProcessLifecycle.Substate(g, now),
        financialState = "NoDebt", section = g.ArchivedAt is not null && GuestConsultations.CanArchive(g, now) ? "Closed" : "Other", balance = data.Balance(g.PersonId!),
        g.ArchivedAt, canArchive = g.ArchivedAt is null && GuestConsultations.CanArchive(g, now),
        actions = GuestConsultations.Occupies(g, now) ? new[] { "Reject" } : [], serverTime = now
    };
    private object ParticipationView(ClientAgendaItem row, ConsultationData data)
    {
        var p = row.Participation!; var e = row.Event!;
        return new { p.Id, kind = row.Kind, sourceId = row.SourceId, activityKind = e.Service.ServiceKind,
            p.PersonId, p.Version, serviceId = e.Service.Id, serviceTitle = e.Service.Title,
            e.Definition.StartsAt, e.Definition.EndsAt, e.Service.Modality, e.Definition.PublicLocation,
            process = ProcessLifecycle.Status(e, p, time.GetUtcNow()), row.State, row.FinancialState, row.Section, e.Service.ReferencePrice, e.Service.PaymentMode,
            finalAmount = p.AgreedTotal ?? p.FinalAmount, amountDue = GroupEvents.AmountDue(data, p),
            p.SettlementId, p.ArchivedAt, p.PublicContentVersion, p.ArchivedContentVersion,
            canArchive = !ClientAgenda.WasSeen(p) && ClientAgenda.CanArchive(data, e, p, time.GetUtcNow()),
            e.ActualStartsAt, e.ActualEndsAt,
            sharedNote = p.Attendance == "Performed" && p.SharedSummaryCiphertext is not null ? Decrypt(p.Id, "event-shared", p.SharedSummaryCiphertext) : null,
            photoIds = Array.Empty<string>() };
    }
    private static object NoticeView(ConsultationNotice notice, ConsultationData data, bool manager, int count)
    {
        if (manager && data.Consultations.SingleOrDefault(c => c.Id == notice.ConsultationId) is { } source)
            return new { notice.Id, notice.ConsultationId, kind = notice.Kind.StartsWith("FollowupMessage:", StringComparison.Ordinal) ? "FollowupMessage" : notice.Kind,
                notice.DueAt, count, source.PersonId, serviceTitle = source.Service.Title, source.StartsAt, source.Service.PublicLocation, source.Service.Modality };
        if (notice.Kind.StartsWith("FollowupMessage:", StringComparison.Ordinal))
            return new { notice.Id, notice.ConsultationId, kind = "FollowupMessage", dueAt = notice.DueAt, count };
        if (notice.Kind == "Approved" && data.Consultations.SingleOrDefault(c => c.Id == notice.ConsultationId) is { } consultation)
            return new { notice.Id, notice.ConsultationId, notice.Kind, notice.DueAt, paymentLabel = ConsultationConditions.Describe(consultation).Label };
        return notice;
    }
    private string Decrypt(string id, string field, string value) => security.Decrypt(id, "consultation-" + field, Convert.FromBase64String(value));
    private static string[] Actions(Consultation c, ConsultationData data, ConsultationActor actor, DateTimeOffset now)
    {
        var actions = new List<string>(); var state = ProcessLifecycle.Substate(c, now);
        if (state == "Requested") { actions.Add("Reject"); if (actor.IsManager) actions.Add("Approve"); }
        if (state == "Confirmed") { actions.Add("Cancel"); if (ConsultationConditions.Pending(c, now)) actions.Add("Accept"); }
        if (actor.IsManager)
        {
            if (ConsultationRules.CanReceiveForConsultation(c, data)) actions.Add("Receipt");
            if (c.State == "Confirmed" && c.ExpectationOpen && c.Service.ReferencePrice > 0 && data.Balance(c.PersonId) >= c.Service.ReferencePrice) actions.Add("UseCreditForAdvance");
            actions.Add("IgnorePaymentAlert");
            if (state == "AwaitingClosure") actions.Add("Close");
            if (c.KeepBlocked) actions.Add("Release");
            if (c.State is "CancelledClient" or "CancelledManager" && c.AvailabilityDecidedAt is null) actions.Add("Keep");
            if (ConsultationRules.HasDebt(c)) actions.Add(c.CollectionClosed ? "ReopenCollection" : "CloseCollection");
            if (ConsultationRules.HasDebt(c) && c.FinalAmount is null) actions.Add("DefineContribution");
        }
        if (!c.CollectionClosed && ConsultationRules.HasDebt(c) && c.FinalAmount > 0) actions.Add(actor.IsManager ? "Settle" : "ProposeCredit");
        if (actor.IsManager && c.CreditProposals.Any(p => p.Decision is null)) actions.Add("DeclineCreditProposal");
        if (!actor.IsManager && !c.CollectionClosed && (ConsultationRules.HasDebt(c) || c.ExpectationOpen)) actions.Add("DeclarePayment");
        if (!actor.IsManager && ConsultationRules.CanArchive(c, now) && (c.ArchivedAt is null || (c.ArchivedContentVersion ?? 1) != c.PublicContentVersion)) actions.Add("Archive");
        return actions.ToArray();
    }
}
