using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public sealed record ManagementAgendaRow(string Id, string Kind, string SourceId, string? PersonId,
    string ServiceTitle, DateTimeOffset StartsAt, DateTimeOffset EndsAt, DateTimeOffset CreatedAt,
    string State, string FinancialState, ProcessStatus Process, string[] PendingReasons, decimal? AmountDue = null,
    string? Modality = null, string? PublicLocation = null, ManagementEventInfo? Event = null);
public sealed record ManagementEventInfo(string Kind, string PaymentMode, bool IsFree, decimal? Price, int Remaining, bool RegistrationOpen);
public sealed record ManagementAgendaCounts(int Upcoming, int Validation, int Payments, int Conditions = 0);
public sealed record ManagementAgendaResult(int Total, int Page, int PageSize, DateTimeOffset ServerTime, ManagementAgendaRow[] Items, ManagementAgendaCounts Counts);
public sealed record ManagementSearchResult(int Total, ManagementAgendaRow[] Items);

// This is a management view of existing records, not another operational state or financial ledger.
public static class ManagementAgenda
{
    public static ManagementAgendaResult Read(ConsultationData data, string section, int page,
        DateTimeOffset now, DateTimeOffset? from = null, DateTimeOffset? to = null)
    {
        if (section is not ("Upcoming" or "Validation" or "Conditions" or "Payments") || page is < 1 or > 100000
            || from is not null && to is not null && from >= to)
            throw new IdentityProblem(400, "Separador, página ou período inválido.");
        var entries = Entries(data, now).ToArray();
        var rows = entries.Where(entry => section == "Upcoming" ? entry.Upcoming : section == "Validation" ? entry.Validation : section == "Conditions" ? entry.Conditions : entry.Payment)
            .Select(entry => entry.Row).Where(row => (from is null || row.EndsAt > from) && (to is null || row.StartsAt < to));
        var ordered = section == "Upcoming" ? rows.OrderBy(r => r.StartsAt).ThenBy(r => r.Kind).ThenBy(r => r.Id)
            : rows.OrderBy(r => r.CreatedAt).ThenBy(r => r.Kind).ThenBy(r => r.Id);
        var selected = ordered.ToArray();
        return new(selected.Length, page, 8, now, selected.Skip((page - 1) * 8).Take(8).ToArray(),
            new(entries.Count(e => e.Upcoming), entries.Count(e => e.Validation), entries.Count(e => e.Payment), entries.Count(e => e.Conditions)));
    }

    public static ManagementSearchResult Search(ConsultationData data, int page, DateTimeOffset now, ClientAgendaFilters filters, bool cancelledOnly = false, string? operationalSection = null)
    {
        var rows = Entries(data, now)
            .Where(e => operationalSection switch {
                "Closure" => e.Row.State == "AwaitingClosure" && (e.Row.Kind != "Participation" || data.Events.Single(item => item.Id == e.Row.SourceId).State == "Performed"),
                "Performed" => e.Row.State == "Performed" && e.Row.Kind != "Participation",
                "NoShow" => e.Row.State == "NoShow",
                _ => true })
            .Where(e => !cancelledOnly || e.Row.State is "Expired" or "Rejected" or "CancelledClient" or "CancelledManager" or "Cancelled")
            .Where(e => filters.PersonId is null || e.Row.PersonId == filters.PersonId)
            .Where(e => filters.State is null || e.Row.State == filters.State)
            .Where(e => filters.Financial is null || (filters.Financial == "OldDebt" ? e.OldDebt : e.Row.FinancialState == filters.Financial))
            .Where(e => (filters.From is null || e.Row.StartsAt >= filters.From) && (filters.To is null || e.Row.StartsAt < filters.To))
            .Where(e => filters.HasNotes is null || e.HasNotes == filters.HasNotes).Select(e => e.Row);
        var ordered = (filters.Sort == "Oldest" ? rows.OrderBy(r => r.StartsAt) : rows.OrderByDescending(r => r.StartsAt))
            .ThenBy(r => r.Kind).ThenBy(r => r.Id).ToArray();
        return new(ordered.Length, ordered.Skip((page - 1) * 8).Take(8).ToArray());
    }

    private sealed record Entry(ManagementAgendaRow Row, bool Upcoming = false, bool Validation = false,
        bool Payment = false, bool HasNotes = false, bool OldDebt = false, bool Conditions = false);

    private static IEnumerable<Entry> Entries(ConsultationData data, DateTimeOffset now)
    {
        foreach (var c in data.Consultations)
        {
            var state = ProcessLifecycle.Substate(c, now);
            var section = ConsultationRules.ManagerSection(c, now);
            var conditions = section == "Conditions";
            var awaitingReceipt = state is "Confirmed" or "AwaitingClosure" && ConsultationRules.AwaitingAdvanceReceipt(c);
            var paymentCommunication = !(state is "Confirmed" or "AwaitingClosure" && c.AdvanceSatisfiedAt is not null)
                && data.Notices.Any(n => n.ConsultationId == c.Id && ConsultationRules.PaymentNoticeActive(n));
            var reasons = new List<string>();
            if (state == "Requested") reasons.Add("Pedido por validar");
            if (conditions) reasons.Add("Condições por aceitar");
            else if (awaitingReceipt) reasons.Add("Pagamento antecipado por validar");
            if (ConsultationRules.HasDebt(c) && c.PaymentDeclaredAt is null) reasons.Add(c.OldDebt ? "Dívida antiga" : c.FinalAmount is null ? "Contribuição por definir" : "Valor em dívida");
            if (paymentCommunication) reasons.Add("Comunicação de pagamento por analisar");
            if (state is "CancelledClient" or "CancelledManager" && c.AvailabilityDecidedAt is null) reasons.Add("Disponibilidade por decidir");
            yield return new(new(c.Id, "Consultation", c.Id, c.PersonId, c.Service.Title, c.StartsAt, c.EndsAt, c.CreatedAt,
                state, ConsultationRules.FinancialState(c), ProcessLifecycle.Status(c, now), reasons.ToArray(), ConsultationCredit.Payable(c) ? ConsultationRules.Remaining(c) : null, c.Service.Modality, c.Service.PublicLocation),
                Upcoming: section == "Upcoming", Validation: state == "Requested",
                Payment: !ConsultationRules.HasOldDebt(c) && !conditions && (awaitingReceipt || ConsultationRules.HasDebt(c) || paymentCommunication),
                HasNotes: c.SharedNoteCiphertext is not null || c.PrivateNoteCiphertext is not null || c.SharedClosureMedia is { Length: > 0 } || c.PrivateClosureMedia is { Length: > 0 }, OldDebt: ConsultationRules.HasOldDebt(c), Conditions: conditions);
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
            var registrationOpen = EventLifecycle.RegistrationOpen(e, now);
            yield return new(new(e.Id, "Event", e.Id, null, e.Service.Title, e.Definition.StartsAt, e.Definition.EndsAt, e.CreatedAt,
                ProcessLifecycle.Substate(e, now), "", ProcessLifecycle.Status(e, now), [],
                Modality: e.Service.Modality, PublicLocation: e.Definition.PublicLocation,
                Event: new(e.Service.ServiceKind!, GroupPaymentConditions.Mode(e), GroupEvents.IsFree(e.Service),
                    e.Definition.TotalPrice ?? e.Service.ReferencePrice,
                    registrationOpen ? Math.Max(0, e.Definition.Capacity - GroupEvents.Seats(data, e.Id)) : 0, registrationOpen)),
                Upcoming: e.State == "Waiting" && e.Definition.StartsAt > now);
            foreach (var p in data.Participations.Where(p => p.EventId == e.Id))
            {
                var reasons = new List<string>();
                var due = GroupEvents.AmountDue(data, p);
                var state = ProcessLifecycle.Substate(e, p, now);
                var validation = p.State is "Requested" or "Waiting" && e.State == "Waiting" && e.Definition.StartsAt > now;
                var conditions = GroupPaymentConditions.Pending(e, p, now);
                if (validation) reasons.Add("Inscrição por validar");
                if (due > 0) reasons.Add("Valor em dívida");
                if (p.State == "Confirmed" && p.ExpectationOpen) reasons.Add("Pagamento antecipado por confirmar");
                var undefined = ClientAgenda.UndefinedDebt(p);
                if (undefined) reasons.Add("Contribuição por definir");
                if (p.PaymentDeclaredAt is not null) reasons.Add("Aguarda confirmação de recebimento pela terapeuta");
                var returnPending = p.ReturnDue > RetreatFinance.Returned(p);
                var returnUndefined = e.Service.ServiceKind == "Retreat" && p.State == "Cancelled" && p.ReturnDue is null && RetreatFinance.Applied(data, p) > 0;
                if (returnPending) reasons.Add("Restituição por concluir");
                if (returnUndefined)
                    reasons.Add("Restituição por decidir");
                yield return new(new(p.Id, "Participation", e.Id, p.PersonId, e.Service.Title, e.Definition.StartsAt, e.Definition.EndsAt,
                    p.CreatedAt, state, ClientAgenda.FinancialState(data, e, p), ParticipationCredit.Status(data, e, p, now), reasons.ToArray(), due > 0 ? due : null, e.Service.Modality, e.Definition.PublicLocation),
                    Validation: validation, Payment: !conditions && (p.State == "Confirmed" && p.ExpectationOpen || due > 0 || undefined || returnPending || returnUndefined),
                    HasNotes: p.SharedSummaryCiphertext is not null || p.PrivateNoteCiphertext is not null, Conditions: conditions);
            }
        }
    }
}
