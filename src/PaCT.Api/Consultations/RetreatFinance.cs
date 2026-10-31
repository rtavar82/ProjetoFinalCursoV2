using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public static class RetreatFinance
{
    private static void Require(bool ok, string message, int status = 409) { if (!ok) throw new IdentityProblem(status, message); }
    private static bool Money(decimal amount) => amount > 0 && amount <= 1000000m && decimal.Round(amount, 2) == amount;
    public static decimal Price(GroupEvent e) => e.Definition.TotalPrice ?? e.Service.ReferencePrice ?? 0;
    public static decimal Applied(ConsultationData data, EventParticipation p) => -data.Entries.Where(e => e.Origin == "EventService" && e.OriginReference == p.Id && e.Kind == "Settlement").Sum(e => e.Amount);
    public static decimal Remaining(ConsultationData data, EventParticipation p) => p.State != "Confirmed" ? 0 : Math.Max(0, (p.AgreedTotal ?? p.FinalAmount ?? 0) - Applied(data, p));
    public static decimal Returned(EventParticipation p) => (p.Returns ?? []).Sum(r => r.Amount);
    public static bool CanReceive(ConsultationData data, EventParticipation p) => p.State == "Confirmed" && p.PersonId is not null
        && Remaining(data, p) > 0 && data.Entries.Where(e => e.PersonId == p.PersonId && e.Kind == "Receipt" && e.Origin == "EventService" && e.OriginReference == p.Id).Sum(e => e.Amount) < (p.AgreedTotal ?? p.FinalAmount ?? 0);
    public static void ValidateDefinition(EventInput input, ConsultationService service)
    {
        Require(Money(input.TotalPrice ?? service.ReferencePrice ?? 0), "Indica o preço único do retiro.", 400);
        IdentityValidation.Required(input.Program, 8000, "o programa completo do retiro");
        IdentityValidation.Required(input.CancellationConditions, 8000, "as condições de cancelamento do retiro");
    }
    public static EventParticipation Settle(ConsultationData data, EventParticipation p, ConsultationCommand input, ConsultationActor actor, DateTimeOffset now)
    {
        Require(actor.IsManager, "A aplicação de saldo ao retiro exige um gestor.", 403);
        var remaining = Remaining(data, p); var amount = input.Amount ?? remaining;
        Require(p.PersonId is not null && remaining > 0 && Money(amount) && amount <= remaining, "Indica um valor até ao montante ainda por liquidar.");
        var observedBalance = data.Balance(p.PersonId!);
        var allocations = CreditLedger.Allocate(data, p.PersonId!, amount); var id = Guid.NewGuid().ToString();
        data.Entries.Add(new(id, p.PersonId!, null, "Settlement", -amount, actor.AccountId, now, null, "Credit", null,
            Origin: "EventService", OriginReference: p.Id, Allocations: allocations, Sequence: CreditLedger.NextSequence(data)));
        return p with { SettledAmount = p.SettledAmount + amount, SettlementId = amount == remaining ? id : null,
            ExpectationOpen = amount != remaining && p.ExpectationOpen,
            AdvanceSatisfiedAt = p.AdvanceSatisfiedAt ?? (amount == remaining ? now : null),
            AdvanceSatisfiedBalance = p.AdvanceSatisfiedBalance ?? (amount == remaining ? observedBalance : null) };
    }
    public static EventParticipation Return(ConsultationData data, GroupEvent ev, EventParticipation p, ConsultationCommand input, ConsultationActor actor, DateTimeOffset now, Func<string, string, string, string> encrypt)
    {
        Require(actor.IsManager, "Esta decisão exige um gestor.", 403);
        Require(ev.Service.ServiceKind == "Retreat" && p.State == "Cancelled" && p.PersonId is not null, "Seleciona uma inscrição cancelada num retiro.");
        var applied = Applied(data, p);
        if (input.Action == "DecideRetreatReturn")
        {
            Require(p.CancellationBy != "Organizer", "O cancelamento pela organização exige restituição integral.");
            Require(input.Amount is >= 0 && input.Amount <= applied && input.Amount >= Returned(p) && decimal.Round(input.Amount.Value, 2) == input.Amount, "Indica o valor a restituir, entre o já restituído e o total aplicado.");
            return p with { ReturnDue = input.Amount, ReturnReasonCiphertext = encrypt(p.Id, "event-return-reason", IdentityValidation.Required(input.Reason, 2000, "o motivo da decisão")) };
        }
        Require(p.ReturnDue is not null && input.Amount is > 0 && Money(input.Amount.Value) && input.Amount <= p.ReturnDue - Returned(p), "Indica um valor até à restituição pendente.");
        Require(input.Method is "Credit" or "Cash" or "Transfer" or "MbWay" or "Card" or "Other", "Escolhe crédito acordado ou o meio da devolução.");
        Require(input.ConditionsAccepted, "Confirma a devolução efetiva ou o acordo para manter o valor em crédito.");
        Require(input.StartsAt > DateTimeOffset.UnixEpoch && input.StartsAt <= now, "Indica a data efetiva da restituição.");
        var id = Guid.NewGuid().ToString(); var amount = input.Amount!.Value;
        // Restore previously applied money; this is not a new receipt.
        data.Entries.Add(new(id, p.PersonId!, null, "Restitution", amount, actor.AccountId, now, null, "Credit", null,
            EffectiveAt: input.StartsAt, Origin: "RetreatReturn", OriginReference: p.Id, Sequence: CreditLedger.NextSequence(data)));
        if (input.Method != "Credit")
        {
            data.Entries.Add(new(Guid.NewGuid().ToString(), p.PersonId!, null, "Refund", -amount, actor.AccountId, now, id, input.Method, null,
                EffectiveAt: input.StartsAt, Origin: "RetreatReturn", OriginReference: p.Id, Allocations: [new(id, amount)], Sequence: CreditLedger.NextSequence(data)));
        }
        return p with { Returns = [..p.Returns ?? [], new(id, amount, input.Method!, input.StartsAt, actor.AccountId, now, id)] };
    }
}
