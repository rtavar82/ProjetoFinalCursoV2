namespace PaCT.Api.Consultations;

public sealed record ClientAgendaFilters(bool Search = false, string? State = null, string? Financial = null,
    DateTimeOffset? From = null, DateTimeOffset? To = null, string? Sort = null, bool? HasNotes = null, bool? Seen = null, string? PersonId = null, string? ServiceId = null);
public sealed record ClientAgendaItem(string Id, string Kind, string SourceId, DateTimeOffset StartsAt, string State,
    string FinancialState, string Section, bool Seen, Consultation? Consultation = null,
    GroupEvent? Event = null, EventParticipation? Participation = null, GuestConsultationRequest? Guest = null);
public sealed record ClientAgendaPage(int Total, int TotalSeen, int TotalUnseen, ClientAgendaItem[] Items);

// One client listing over existing consultations and personal participations. No new booking or ledger.
public static class ClientAgenda
{
    public static bool UndefinedDebt(EventParticipation p) => p.State == "Confirmed" && p.FinancialChoice == "Unpaid"
        && p.SettlementId is null && p.FinalAmount is null;
    public static bool WasSeen(EventParticipation p) => p.ArchivedAt is not null && p.ArchivedContentVersion == p.PublicContentVersion;
    public static bool CanArchive(ConsultationData data, GroupEvent e, EventParticipation p, DateTimeOffset now) => !p.ExpectationOpen
        && GroupEvents.AmountDue(data, p) == 0 && !UndefinedDebt(p) && (p.ReturnDue ?? 0) <= RetreatFinance.Returned(p)
        && ProcessLifecycle.Substate(e, p, now) is "Performed" or "NoShow" or "Expired" or "Rejected" or "Cancelled";
    public static string Section(ConsultationData data, GroupEvent e, EventParticipation p, DateTimeOffset now) =>
        p.State == "Confirmed" && p.ExpectationOpen || GroupEvents.AmountDue(data, p) > 0 || UndefinedDebt(p) ? "Payments"
        : ProcessLifecycle.Substate(e, p, now) is "Performed" or "NoShow" || p.ArchivedAt is not null && CanArchive(data, e, p, now) ? "Closed"
        : ProcessLifecycle.Substate(e, p, now) == "Confirmed" && e.State == "Scheduled" && e.Definition.StartsAt > now ? "Upcoming" : "Other";
    public static string FinancialState(ConsultationData data, GroupEvent e, EventParticipation p) =>
        p.State == "Confirmed" && p.ExpectationOpen ? "AwaitingReceipt" : UndefinedDebt(p) ? "ContributionUndefined" : GroupEvents.AmountDue(data, p) > 0 ? "Unpaid"
        : p.SettlementId is not null || e.Service.ServiceKind == "Retreat" && RetreatFinance.Applied(data, p) > 0 ? "Paid" : "NoDebt";

    public static ClientAgendaPage Read(ConsultationData data, string personId, string section, int page,
        DateTimeOffset now, ClientAgendaFilters filters)
    {
        if (filters.PersonId is not null && filters.PersonId != personId) return new(0, 0, 0, []);
        var rows = data.Consultations.Where(c => c.PersonId == personId)
            .Where(c => filters.ServiceId is null || c.Service.Id == filters.ServiceId)
            .Where(c => section == "Followup" ? c.State == "Performed" && ConsultationRules.ClientSection(c, now) == "Closed"
                : filters.Search || ConsultationRules.ClientSection(c, now) == section)
            .Where(c => filters.State is null || ProcessLifecycle.Substate(c, now) == filters.State)
            .Where(c => filters.Financial is null || (filters.Financial == "CollectionClosed" ? c.CollectionClosed : ConsultationRules.FinancialState(c) == filters.Financial))
            .Where(c => (filters.From is null || c.StartsAt >= filters.From) && (filters.To is null || c.StartsAt < filters.To))
            .Where(c => filters.HasNotes is null || filters.HasNotes == (c.SharedNoteCiphertext is not null))
            .Select(c => new ClientAgendaItem(c.Id, "Consultation", c.Id, c.StartsAt, ProcessLifecycle.Substate(c, now),
                ConsultationRules.FinancialState(c), ConsultationRules.ClientSection(c, now),
                c.ArchivedAt is not null && (c.ArchivedContentVersion ?? 1) == c.PublicContentVersion, Consultation: c))
            .ToList();
        // Followup is the existing individual conversation query. Closed is the shared client history.
        if (section != "Followup")
            foreach (var p in data.Participations.Where(p => p.PersonId == personId))
            {
                var e = data.Events.Single(e => e.Id == p.EventId);
                var state = p.State == "Cancelled" && p.Stage == ProcessStage.Request && p.CancellationBy == "Rejected" ? "Rejected" : ProcessLifecycle.Substate(e, p, now);
                var financial = FinancialState(data, e, p); var target = Section(data, e, p, now);
                if (filters.ServiceId is not null && e.Service.Id != filters.ServiceId || !filters.Search && target != section || filters.State is not null && state != filters.State
                    || filters.Financial is not null && financial != filters.Financial
                    || filters.From is not null && e.Definition.StartsAt < filters.From || filters.To is not null && e.Definition.StartsAt >= filters.To
                    || filters.HasNotes is not null && filters.HasNotes != (p.Attendance == "Performed" && p.SharedSummaryCiphertext is not null)) continue;
                rows.Add(new(p.Id, "Participation", e.Id, e.Definition.StartsAt, state, financial, target, WasSeen(p), Event: e, Participation: p));
            }
        if (section != "Followup")
            foreach (var guest in data.GuestRequests.Where(g => g.PersonId == personId && g.State != "Linked"))
            {
                var state = ProcessLifecycle.Substate(guest, now); if (state == "InTreatment") state = "Requested";
                var target = guest.ArchivedAt is not null && GuestConsultations.CanArchive(guest, now) ? "Closed" : "Other";
                if (!filters.Search && target != section || filters.ServiceId is not null && guest.Service.Id != filters.ServiceId
                    || filters.State is not null && filters.State != state || filters.Financial is not (null or "NoDebt")
                    || filters.From is not null && guest.StartsAt < filters.From || filters.To is not null && guest.StartsAt >= filters.To
                    || filters.HasNotes == true) continue;
                rows.Add(new(guest.Id, "Guest", guest.Id, guest.StartsAt, state, "NoDebt", target, guest.ArchivedAt is not null, Guest: guest));
            }
        var selected = rows.Where(r => filters.Seen is null || r.Seen == filters.Seen);
        var descending = filters.Sort == "Newest" || filters.Sort is null && section is "Closed" or "Followup";
        var ordered = (descending ? selected.OrderByDescending(r => r.StartsAt) : selected.OrderBy(r => r.StartsAt))
            .ThenBy(r => r.Kind).ThenBy(r => r.Id).ToArray();
        return new(ordered.Length, rows.Count(r => r.Seen), rows.Count(r => !r.Seen), ordered.Skip((page - 1) * 8).Take(8).ToArray());
    }
}
