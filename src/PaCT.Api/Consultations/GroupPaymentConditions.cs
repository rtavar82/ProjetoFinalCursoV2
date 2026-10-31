using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public static class GroupPaymentConditions
{
    public static string Mode(GroupEvent item) => item.Service.ServiceKind == "Group"
        ? item.Definition.BillingMode ?? item.Service.PaymentMode : item.Service.PaymentMode;
    public static ConsultationConditionSet Describe(GroupEvent item)
    {
        var fingerprint = JsonSerializer.Serialize(new { item.Id, item.ScheduleVersion, item.Service.Version,
            Mode = Mode(item), item.Service.ReferencePrice, item.Definition.StartsAt, item.Definition.EndsAt, item.Definition.PublicLocation });
        var version = ConsultationRules.TermsVersion + ":group:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(fingerprint)));
        return ConsultationConditions.DescribeMode(Mode(item), version);
    }
    public static void ValidateDefinition(EventInput input, ConsultationService service, GroupEvent? existing, ConsultationData data)
    {
        if (input.BillingMode is not null && (service.ServiceKind != "Group" || GroupEvents.IsFree(service)
            || input.BillingMode is not ("Prepayment" or "Postpayment" or "Contribution")
            || (input.BillingMode == "Contribution") != (service.PaymentMode == "Contribution")))
            throw new IdentityProblem(400, "Escolhe o pagamento aplicável a esta consulta de grupo.");
        if (existing is not null && data.Participations.Any(p => p.EventId == existing.Id && p.State == "Confirmed")
            && Mode(existing) != (input.BillingMode ?? service.PaymentMode))
            throw new IdentityProblem(409, "Já existem inscrições confirmadas com as condições anteriores.");
    }
    public static void ValidateAcceptance(GroupEvent item, ConsultationCommand input)
    {
        if (!input.ConditionsAccepted || input.TermsVersion != Describe(item).Version)
            throw new IdentityProblem(400, "Abre as condições da consulta de grupo e confirma que as aceitas antes de te inscreveres.");
    }
    public static bool CanReceive(ConsultationData data, GroupEvent item, EventParticipation p) => !GroupEvents.IsFree(item.Service)
        && p.State == "Confirmed" && p.SettlementId is null && p.PersonId is not null
        && (p.ExpectationOpen && p.AdvanceSatisfiedAt is null
            || p.Attendance == "Performed" && p.FinancialChoice == "Unpaid" && (p.FinalAmount is null || GroupEvents.AmountDue(data, p) > data.Balance(p.PersonId)));
    public static void AcceptanceNotice(ConsultationData data, GroupEvent item, EventParticipation participation, DateTimeOffset now)
    {
        if (participation.PersonId is null || !data.ClientAccountPeople.Contains(participation.PersonId)
            || data.EventNotices.Any(n => n.ParticipationId == participation.Id && n.Kind == "EventAcceptanceSummary")) return;
        data.EventNotices.Add(new(Guid.NewGuid().ToString(), item.Id, participation.Id, participation.PersonId,
            "EventAcceptanceSummary", item.ScheduleVersion, now, null, PushState: "Pending"));
    }
    public static void SatisfyAdvances(ConsultationData data, DateTimeOffset now)
    {
        var received = data.Entries.Where(e => e.Kind == "Receipt" && e.Origin == "EventService" && e.OriginReference is not null)
            .GroupBy(e => (e.PersonId, e.OriginReference)).ToDictionary(g => g.Key, g => g.Sum(e => e.Amount));
        for (var i = 0; i < data.Participations.Count; i++)
        {
            var p = data.Participations[i];
            if (!p.ExpectationOpen || p.PersonId is null || p.AdvanceSatisfiedAt is not null) continue;
            var item = data.Events.Single(e => e.Id == p.EventId);
            var ownReceipts = received.GetValueOrDefault((p.PersonId, p.Id));
            if (p.State != "Confirmed" || item.State == "Cancelled" || p.Attendance is not null)
                data.Participations[i] = p with { ExpectationOpen = false, Version = p.Version + 1 };
            else if (item.Service.ReferencePrice is > 0 && ownReceipts >= item.Service.ReferencePrice)
                data.Participations[i] = p with { ExpectationOpen = false, AdvanceSatisfiedAt = now, AdvanceSatisfiedBalance = data.Balance(p.PersonId), Version = p.Version + 1 };
        }
        var awaiting = data.Participations.Where(p => p.State == "Confirmed" && p.ExpectationOpen).Select(p => p.Id).ToHashSet();
        for (var i = 0; i < data.EventNotices.Count; i++)
            if (data.EventNotices[i] is var notice && !notice.Cancelled && notice.Kind is "EventWait8" or "EventWait12" && !awaiting.Contains(notice.ParticipationId))
                data.EventNotices[i] = notice with { Cancelled = true };
    }
}
