using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public static class ParticipationCredit
{
    public static string FinancialState(ConsultationData data, GroupEvent e, EventParticipation p) => GroupEvents.IsFree(e.Service) ? "Free"
        : p.State != "Confirmed" || p.FinancialChoice is "NoCharge" or "Pack" ? "NoDebt"
        : p.RequiresClientAcceptance && p.AcceptedAt is null && p.Attendance is null ? "ConditionsPending"
        : p.PaymentDeclaredAt is not null ? "PaymentDeclared"
        : Remaining(data, e, p) == 0 && Target(e, p) is > 0 ? "Paid"
        : Applied(data, p) > 0 ? "PartiallyPaid"
        : p.ExpectationOpen ? "AwaitingReceipt"
        : p.Attendance == "Performed" && Target(e, p) is null ? "ContributionUndefined"
        : Remaining(data, e, p) > 0 && GroupPaymentConditions.Received(data, p) >= Target(e, p) ? "ReceivedPendingSettlement"
        : Remaining(data, e, p) > 0 ? "Unpaid" : "NoDebt";
    public static string FinancialLabel(string state) => state switch {
        "Free" => "Gratuito", "Paid" => "Paga", "PartiallyPaid" => "Parcialmente paga", "Unpaid" => "Por pagar",
        "AwaitingReceipt" => "Aguarda recebimento", "PaymentDeclared" => "Aguarda confirmação de recebimento pela terapeuta",
        "ConditionsPending" => "Condições por aceitar", "ContributionUndefined" => "Contribuição por definir",
        "ReceivedPendingSettlement" => "Recebimento confirmado · Falta liquidar", _ => "Sem dívida" };
    public static ProcessStatus Status(ConsultationData data, GroupEvent e, EventParticipation p, DateTimeOffset now)
    {
        var status = EventLifecycle.Status(e, p, now);
        var label = FinancialLabel(FinancialState(data, e, p));
        return status.ProcessLabel.Contains(label, StringComparison.OrdinalIgnoreCase) ? status
            : status with { ProcessLabel = status.ProcessLabel + " · " + label };
    }
    public static decimal? Target(GroupEvent e, EventParticipation p) => p.FinalAmount ?? p.AgreedTotal
        ?? (GroupPaymentConditions.Mode(e) == "Prepayment" ? e.Definition.TotalPrice ?? e.Service.ReferencePrice : null);
    public static decimal Applied(ConsultationData data, EventParticipation p) => -data.Entries
        .Where(x => x.Origin == "EventService" && x.OriginReference == p.Id && x.Kind is "Settlement" or "SettlementReturn").Sum(x => x.Amount);
    public static decimal Remaining(ConsultationData data, GroupEvent e, EventParticipation p) => p.State == "Confirmed"
        && !GroupEvents.IsFree(e.Service) && p.FinancialChoice is not ("NoCharge" or "Pack")
        ? Math.Max(0, (Target(e, p) ?? 0) - Applied(data, p)) : 0;
    public static bool Payable(GroupEvent e, EventParticipation p) => e.State != "Cancelled" && p.State == "Confirmed"
        && p.PersonId is not null && p.FinancialChoice is not ("NoCharge" or "Pack") && !GroupEvents.IsFree(e.Service)
        && (GroupPaymentConditions.Mode(e) == "Prepayment" || p.Attendance == "Performed");
    public static EventParticipation Authorize(ConsultationData data, GroupEvent e, EventParticipation p, string authorId, DateTimeOffset now)
    {
        if (!e.Definition.AllowClientCredit || GroupPaymentConditions.Mode(e) != "Prepayment" || p.PersonId is null) return p;
        var amount = Math.Max(0, Math.Min(data.Balance(p.PersonId), Remaining(data, e, p)));
        var sources = amount > 0 ? CreditLedger.Allocate(data, p.PersonId, amount) : [];
        return p with { CreditAuthorizations = [..p.CreditAuthorizations ?? [], new(Guid.NewGuid().ToString(), authorId, now, "Enrolment", true, sources)] };
    }
    public static decimal Available(ConsultationData data, GroupEvent e, EventParticipation p)
    {
        if (!Payable(e, p) || p.PersonId is null) return 0;
        var limits = CreditLedger.AuthorizationLimits(data, p.CreditAuthorizations?.LastOrDefault());
        var sources = CreditLedger.Available(data, p.PersonId);
        return Math.Max(0, Math.Min(Remaining(data, e, p), Math.Min(data.Balance(p.PersonId),
            limits.Sum(x => Math.Min(x.Value, Math.Max(0, sources.GetValueOrDefault(x.Key)))))));
    }
    public static EventParticipation Settle(ConsultationData data, GroupEvent e, EventParticipation p, decimal? amount,
        ConsultationActor actor, DateTimeOffset now, IReadOnlyDictionary<string, decimal>? limits = null)
    {
        var remaining = Remaining(data, e, p);
        amount ??= remaining;
        if (!Payable(e, p) || amount <= 0 || amount > remaining || amount > 1000000 || decimal.Round(amount.Value, 2) != amount)
            throw new IdentityProblem(409, "Indica um valor positivo até ao montante por liquidar desta inscrição.");
        var authorization = p.CreditAuthorizations?.LastOrDefault();
        if (!actor.IsManager)
        {
            if (actor.PersonId != p.PersonId || p.AcceptedAt is null || amount > Available(data, e, p))
                throw new IdentityProblem(409, "Não existe crédito autorizado disponível para este valor.");
            limits = CreditLedger.AuthorizationLimits(data, authorization);
        }
        var id = CreditLedger.Settle(data, p.PersonId!, amount.Value, actor, now, "EventService", p.Id,
            limits: limits, authorizationId: actor.IsManager ? null : authorization?.Id);
        var paid = amount == remaining;
        return p with { SettledAmount = Applied(data, p), SettlementId = paid ? id : null,
            ExpectationOpen = !paid && p.ExpectationOpen, PaymentDeclaredAt = null,
            AdvanceSatisfiedAt = paid ? p.AdvanceSatisfiedAt ?? now : p.AdvanceSatisfiedAt };
    }
    public static EventParticipation Reconcile(ConsultationData data, EventParticipation p, decimal target, ConsultationActor actor, DateTimeOffset now)
    {
        var applied = Applied(data, p);
        CreditLedger.Restore(data, p.PersonId!, "EventService", p.Id, Math.Max(0, applied - target), actor, now);
        var current = Applied(data, p);
        return p with { SettledAmount = current, SettlementId = target > 0 && current >= target
            ? data.Entries.Last(x => x.Origin == "EventService" && x.OriginReference == p.Id && x.Kind == "Settlement").Id : null };
    }
    public static EventParticipation ReceiveContribution(ConsultationData data, GroupEvent e, EventParticipation p, CreditEntry receipt,
        ConsultationActor actor, DateTimeOffset now)
    {
        if (GroupPaymentConditions.Mode(e) != "Contribution" || p.Attendance != "Performed" || p.FinalAmount is not null)
            throw new IdentityProblem(409, "A contribuição desta participação já foi definida.");
        return Settle(data, e, p with { FinalAmount = receipt.Amount, FinancialChoice = "Unpaid" }, receipt.Amount, actor, now,
            new Dictionary<string, decimal> { [receipt.Id] = receipt.Amount });
    }
}
