using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public sealed record ManagementAgendaRow(string Id, string Kind, string SourceId, string? PersonId,
    string ServiceTitle, DateTimeOffset StartsAt, DateTimeOffset EndsAt, DateTimeOffset CreatedAt,
    string State, string FinancialState, ProcessStatus Process, string[] PendingReasons, decimal? AmountDue = null,
    string? Modality = null, string? PublicLocation = null);
public sealed record ManagementAgendaCounts(int Upcoming, int Validation, int Payments);
public sealed record ManagementAgendaResult(int Total, int Page, int PageSize, DateTimeOffset ServerTime, ManagementAgendaRow[] Items, ManagementAgendaCounts Counts);
public sealed record ManagementSearchResult(int Total, ManagementAgendaRow[] Items);

// This is a management view of existing records, not another operational state or financial ledger.
public static class ManagementAgenda
{
    public static ManagementAgendaResult Read(ConsultationData data, string section, int page,
        DateTimeOffset now, DateTimeOffset? from = null, DateTimeOffset? to = null)
    {
        if (section is not ("Upcoming" or "Validation" or "Payments") || page is < 1 or > 100000
            || from is not null && to is not null && from >= to)
            throw new IdentityProblem(400, "Separador, página ou período inválido.");
        var entries = Entries(data, now).ToArray();
        var rows = entries.Where(entry => section == "Upcoming" ? entry.Upcoming : section == "Validation" ? entry.Validation : entry.Payment)
            .Select(entry => entry.Row).Where(row => (from is null || row.EndsAt > from) && (to is null || row.StartsAt < to));
        var ordered = section == "Upcoming" ? rows.OrderBy(r => r.StartsAt).ThenBy(r => r.Kind).ThenBy(r => r.Id)
            : rows.OrderBy(r => r.CreatedAt).ThenBy(r => r.Kind).ThenBy(r => r.Id);
        var selected = ordered.ToArray();
        return new(selected.Length, page, 8, now, selected.Skip((page - 1) * 8).Take(8).ToArray(),
            new(entries.Count(e => e.Upcoming), entries.Count(e => e.Validation), entries.Count(e => e.Payment)));
    }

    public static ManagementSearchResult Search(ConsultationData data, int page, DateTimeOffset now, ClientAgendaFilters filters)
    {
        var rows = Entries(data, now)
            .Where(e => filters.PersonId is null || e.Row.PersonId == filters.PersonId)
            .Where(e => filters.State is null || e.Row.State == filters.State)
            .Where(e => filters.Financial is null || (filters.Financial == "CollectionClosed" ? e.CollectionClosed : e.Row.FinancialState == filters.Financial))
            .Where(e => (filters.From is null || e.Row.StartsAt >= filters.From) && (filters.To is null || e.Row.StartsAt < filters.To))
            .Where(e => filters.HasNotes is null || e.HasNotes == filters.HasNotes).Select(e => e.Row);
        var ordered = (filters.Sort == "Oldest" ? rows.OrderBy(r => r.StartsAt) : rows.OrderByDescending(r => r.StartsAt))
            .ThenBy(r => r.Kind).ThenBy(r => r.Id).ToArray();
        return new(ordered.Length, ordered.Skip((page - 1) * 8).Take(8).ToArray());
    }

    private sealed record Entry(ManagementAgendaRow Row, bool Upcoming = false, bool Validation = false,
        bool Payment = false, bool HasNotes = false, bool CollectionClosed = false);

    private static IEnumerable<Entry> Entries(ConsultationData data, DateTimeOffset now)
    {
        foreach (var c in data.Consultations)
        {
            var state = ProcessLifecycle.Substate(c, now);
            var reasons = new List<string>();
            if (state == "Requested") reasons.Add("Pedido por validar");
            if (c.ExpectationOpen && state is "Confirmed" or "AwaitingClosure") reasons.Add("Pagamento antecipado por validar");
            if (ConsultationRules.HasDebt(c)) reasons.Add(c.CollectionClosed ? "Dívida — cobrança encerrada" : "Valor em dívida");
            if (data.Notices.Any(n => n.ConsultationId == c.Id && ConsultationRules.PaymentNoticeActive(n))) reasons.Add("Comunicação de pagamento por analisar");
            if (state is "CancelledClient" or "CancelledManager" && c.AvailabilityDecidedAt is null) reasons.Add("Disponibilidade por decidir");
            yield return new(new(c.Id, "Consultation", c.Id, c.PersonId, c.Service.Title, c.StartsAt, c.EndsAt, c.CreatedAt,
                state, ConsultationRules.FinancialState(c), ProcessLifecycle.Status(c, now), reasons.ToArray(), ConsultationRules.HasDebt(c) && c.FinalAmount is not null ? ConsultationRules.Remaining(c) : null, c.Service.Modality, c.Service.PublicLocation),
                Upcoming: state == "Confirmed" && c.StartsAt > now && !c.ExpectationOpen, Validation: state == "Requested",
                Payment: c.ExpectationOpen && state is "Confirmed" or "AwaitingClosure" || ConsultationRules.HasDebt(c)
                    || data.Notices.Any(n => n.ConsultationId == c.Id && ConsultationRules.PaymentNoticeActive(n)),
                HasNotes: c.SharedNoteCiphertext is not null || c.PrivateNoteCiphertext is not null, CollectionClosed: c.CollectionClosed);
        }
        foreach (var g in data.GuestRequests.Where(g => g.ConsultationId is null))
        {
            var state = ProcessLifecycle.Substate(g, now);
            yield return new(new(g.Id, "Guest", g.Id, g.PersonId, g.Service.Title, g.StartsAt, g.EndsAt, g.CreatedAt,
                state == "InTreatment" ? "Requested" : state, "NoDebt", ProcessLifecycle.Status(g, now), GuestConsultations.Occupies(g, now) ? ["Pedido sem conta por validar"] : [],
                Modality: g.Service.Modality, PublicLocation: g.Service.PublicLocation), Validation: GuestConsultations.Occupies(g, now));
        }
        foreach (var e in data.Events)
        {
            yield return new(new(e.Id, "Event", e.Id, null, e.Service.Title, e.Definition.StartsAt, e.Definition.EndsAt, e.CreatedAt,
                ProcessLifecycle.Substate(e, now), "", ProcessLifecycle.Status(e, now), [],
                Modality: e.Service.Modality, PublicLocation: e.Definition.PublicLocation),
                Upcoming: e.State == "Scheduled" && e.Definition.StartsAt > now);
            foreach (var p in data.Participations.Where(p => p.EventId == e.Id))
            {
                var reasons = new List<string>();
                var due = GroupEvents.AmountDue(data, p);
                var state = ProcessLifecycle.Substate(e, p, now);
                var validation = p.State == "Requested" && e.State == "Scheduled" && e.Definition.StartsAt > now;
                if (validation) reasons.Add("Inscrição por validar");
                if (p.ProtectedSeat) reasons.Add("Vaga protegida");
                if (due > 0) reasons.Add("Valor em dívida");
                if (p.State == "Confirmed" && p.ExpectationOpen) reasons.Add("Pagamento antecipado por confirmar");
                var undefined = p.State == "Confirmed" && p.FinancialChoice == "Unpaid" && p.SettlementId is null && p.FinalAmount is null;
                if (undefined) reasons.Add("Contribuição por definir");
                var returnPending = p.ReturnDue > RetreatFinance.Returned(p);
                var returnUndefined = e.Service.ServiceKind == "Retreat" && p.State == "Cancelled" && p.ReturnDue is null && RetreatFinance.Applied(data, p) > 0;
                if (returnPending) reasons.Add("Restituição por concluir");
                if (returnUndefined)
                    reasons.Add("Restituição por decidir");
                yield return new(new(p.Id, "Participation", e.Id, p.PersonId, e.Service.Title, e.Definition.StartsAt, e.Definition.EndsAt,
                    p.CreatedAt, state, ClientAgenda.FinancialState(data, e, p), ProcessLifecycle.Status(e, p, now), reasons.ToArray(), due > 0 ? due : null, e.Service.Modality, e.Definition.PublicLocation),
                    Validation: validation, Payment: p.State == "Confirmed" && p.ExpectationOpen || due > 0 || undefined || returnPending || returnUndefined,
                    HasNotes: p.SharedSummaryCiphertext is not null || p.PrivateNoteCiphertext is not null);
            }
        }
    }
}
