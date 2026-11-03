using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public static class GroupPaymentConditions
{
    public static string Mode(GroupEvent item) => item.Service.ServiceKind == "Retreat" ? "Prepayment" : item.Service.ServiceKind == "Group"
        ? item.Definition.BillingMode ?? item.Service.PaymentMode : item.Service.PaymentMode;
    public static bool Pending(GroupEvent item, EventParticipation participation, DateTimeOffset now) => participation.RequiresClientAcceptance
        && participation.AcceptedAt is null && participation.State == "Confirmed" && item.State != "Cancelled" && participation.Attendance is null;
    public static ConsultationConditionSet Describe(GroupEvent item)
    {
        var fingerprint = JsonSerializer.Serialize(new { item.Id, item.ScheduleVersion, item.Service.Version,
            Mode = Mode(item), item.Definition.TotalPrice, item.Service.ReferencePrice, item.Definition.Program, item.Definition.CancellationConditions,
            item.Definition.StartsAt, item.Definition.EndsAt, item.Definition.PublicLocation });
        var version = ConsultationRules.TermsVersion + ":group:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(fingerprint)));
        var common = ConsultationConditions.DescribeMode(Mode(item), version);
        string Wording(string text) => text.Replace("consulta", item.Service.ServiceKind == "Retreat" ? "retiro" : "grupo", StringComparison.Ordinal);
        var sections = common.Sections.Select(section => new ConditionSection(Wording(section.Title), section.Paragraphs.Select(Wording).ToArray(), section.Bullets.Select(Wording).ToArray())).ToList();
        if (item.Service.ServiceKind == "Retreat")
        {
            sections.Insert(0, new("Programa do retiro", [item.Definition.Program ?? ""], []));
            if (!string.IsNullOrWhiteSpace(item.Definition.CancellationConditions)) sections.Add(new("Condições próprias do retiro", [item.Definition.CancellationConditions], []));
        }
        return common with { Sections = sections.ToArray(), Label = Wording(common.Label), AcceptLabel = Wording(common.AcceptLabel) };
    }
    public static void ValidateDefinition(EventInput input, ConsultationService service, GroupEvent? existing, ConsultationData data)
    {
        if (service.ServiceKind == "Group" && !GroupEvents.IsFree(service) && (input.BillingMode ?? service.PaymentMode) is not ("Prepayment" or "Contribution"))
            throw new IdentityProblem(400, "Um grupo pago usa pré-pagamento ou contribuição livre depois do evento.");
        if (input.BillingMode is not null && (service.ServiceKind != "Group" || GroupEvents.IsFree(service)
            || input.BillingMode is not ("Prepayment" or "Contribution")))
            throw new IdentityProblem(400, "Escolhe o pagamento aplicável a esta consulta de grupo.");
        if (existing is not null && data.Participations.Any(p => p.EventId == existing.Id && (p.State == "Confirmed" || p.State == "Requested" && p.AcceptedAt is not null))
            && Mode(existing) != (input.BillingMode ?? service.PaymentMode))
            throw new IdentityProblem(409, "Já existem inscrições confirmadas com as condições anteriores.");
    }
    public static void ValidateAcceptance(GroupEvent item, ConsultationCommand input) => ValidateAcceptance(item, input.ConditionsAccepted, input.TermsVersion);
    public static void ValidateAcceptance(GroupEvent item, bool accepted, string? version)
    {
        if (!accepted || version != Describe(item).Version)
            throw new IdentityProblem(400, "Abre as condições da consulta de grupo e confirma que as aceitas antes de te inscreveres.");
    }
    public static decimal Received(ConsultationData data, EventParticipation p) => data.Entries.Where(x => x.PersonId == p.PersonId
        && x.Kind == "Receipt" && x.Origin == "EventService" && x.OriginReference == p.Id).Sum(x => x.Amount);
    public static bool CanReceive(ConsultationData data, GroupEvent item, EventParticipation p) => ParticipationCredit.Payable(item, p)
        && (ParticipationCredit.Target(item, p) is null || ParticipationCredit.Remaining(data, item, p) > 0
            && Received(data, p) < ParticipationCredit.Target(item, p));
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
            if (p.State != "Confirmed" || item.State == "Cancelled" || p.Attendance == "NoShow" || p.FinancialChoice is "NoCharge" or "Pack")
                data.Participations[i] = p with { ExpectationOpen = false, Version = p.Version + 1 };
            else if (ParticipationCredit.Target(item, p) is > 0 && (ownReceipts >= ParticipationCredit.Target(item, p)
                || ParticipationCredit.Remaining(data, item, p) == 0))
                data.Participations[i] = p with { ExpectationOpen = false, AdvanceSatisfiedAt = now, AdvanceSatisfiedBalance = data.Balance(p.PersonId), Version = p.Version + 1 };
        }
        var awaiting = data.Participations.Where(p => p.State == "Confirmed" && p.ExpectationOpen).Select(p => p.Id).ToHashSet();
        for (var i = 0; i < data.EventNotices.Count; i++)
            if (data.EventNotices[i] is var notice && !notice.Cancelled && notice.Kind is "EventWait8" or "EventWait12" && (notice.ParticipationId is null || !awaiting.Contains(notice.ParticipationId)))
                data.EventNotices[i] = notice with { Cancelled = true };
    }
}
