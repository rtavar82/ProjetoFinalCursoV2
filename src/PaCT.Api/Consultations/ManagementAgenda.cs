using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public sealed record ManagementAgendaRow(string Id, string Kind, string SourceId, string? PersonId,
    string ServiceTitle, DateTimeOffset StartsAt, DateTimeOffset EndsAt, DateTimeOffset CreatedAt,
    string State, string FinancialState, string[] PendingReasons, decimal? AmountDue = null);
public sealed record ManagementAgendaResult(int Total, int Page, int PageSize, DateTimeOffset ServerTime, ManagementAgendaRow[] Items);

// This is a management view of existing records, not another operational state or financial ledger.
public static class ManagementAgenda
{
    public static ManagementAgendaResult Read(ConsultationData data, string section, int page,
        DateTimeOffset now, DateTimeOffset? from = null, DateTimeOffset? to = null)
    {
        if (section is not ("Upcoming" or "Pending" or "All") || page is < 1 or > 100000
            || from is not null && to is not null && from >= to)
            throw new IdentityProblem(400, "Separador, página ou período inválido.");
        var rows = new List<ManagementAgendaRow>();
        foreach (var c in data.Consultations)
        {
            var state = ConsultationRules.State(c, now);
            var reasons = new List<string>();
            if (state == "Requested") reasons.Add("Pedido por validar");
            if (c.ExpectationOpen && state is "Confirmed" or "AwaitingClosure") reasons.Add("Pagamento antecipado por validar");
            if (ConsultationRules.HasDebt(c)) reasons.Add(c.CollectionClosed ? "Dívida — cobrança encerrada" : "Valor em dívida");
            if (data.Notices.Any(n => n.ConsultationId == c.Id && ConsultationRules.PaymentNoticeActive(n))) reasons.Add("Comunicação de pagamento por analisar");
            if (state is "CancelledClient" or "CancelledManager" && c.AvailabilityDecidedAt is null) reasons.Add("Disponibilidade por decidir");
            Add(new(c.Id, "Consultation", c.Id, c.PersonId, c.Service.Title, c.StartsAt, c.EndsAt, c.CreatedAt,
                state, ConsultationRules.FinancialState(c), reasons.ToArray(), ConsultationRules.HasDebt(c) ? c.FinalAmount : null),
                state == "Confirmed" && c.StartsAt > now && !c.ExpectationOpen);
        }
        foreach (var g in data.GuestRequests.Where(g => g.ConsultationId is null))
        {
            var state = GuestConsultations.State(g, now);
            Add(new(g.Id, "Guest", g.Id, g.PersonId, g.Service.Title, g.StartsAt, g.EndsAt, g.CreatedAt,
                state, "", GuestConsultations.Occupies(g, now) ? ["Pedido sem conta por validar"] : []), false);
        }
        foreach (var e in data.Events)
        {
            Add(new(e.Id, "Event", e.Id, null, e.Service.Title, e.Definition.StartsAt, e.Definition.EndsAt, e.CreatedAt,
                e.State, "", []),
                e.State == "Scheduled" && e.Definition.StartsAt > now);
            foreach (var p in data.Participations.Where(p => p.EventId == e.Id))
            {
                var reasons = new List<string>();
                var due = GroupEvents.AmountDue(data, p);
                if (p.State == "Requested") reasons.Add("Inscrição por validar");
                if (p.ProtectedSeat) reasons.Add("Vaga protegida");
                if (due > 0) reasons.Add("Valor em dívida");
                var undefined = p.State == "Confirmed" && p.FinancialChoice == "Unpaid" && p.SettlementId is null && p.FinalAmount is null;
                if (undefined) reasons.Add("Contribuição por definir");
                if (p.ReturnDue > RetreatFinance.Returned(p)) reasons.Add("Restituição por concluir");
                if (e.Service.ServiceKind == "Retreat" && p.State == "Cancelled" && p.ReturnDue is null && RetreatFinance.Applied(data, p) > 0)
                    reasons.Add("Restituição por decidir");
                Add(new(p.Id, "Participation", e.Id, p.PersonId, e.Service.Title, e.Definition.StartsAt, e.Definition.EndsAt,
                    p.CreatedAt, p.State, due > 0 ? "Unpaid" : undefined ? "ContributionUndefined" : "", reasons.ToArray(), due > 0 ? due : null), false);
            }
        }
        var ordered = section == "Pending" ? rows.OrderBy(r => r.CreatedAt).ThenBy(r => r.Kind).ThenBy(r => r.Id)
            : section == "Upcoming" ? rows.OrderBy(r => r.StartsAt).ThenBy(r => r.Kind).ThenBy(r => r.Id)
            : rows.OrderByDescending(r => r.StartsAt).ThenBy(r => r.Kind).ThenBy(r => r.Id);
        return new(rows.Count, page, 8, now, ordered.Skip((page - 1) * 8).Take(8).ToArray());

        void Add(ManagementAgendaRow row, bool upcoming)
        {
            if (section == "Upcoming" && !upcoming || section == "Pending" && row.PendingReasons.Length == 0) return;
            if (from is not null && row.EndsAt <= from || to is not null && row.StartsAt >= to) return;
            rows.Add(row);
        }
    }
}
