using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

// Authorization identifies existing credit sources; it never reserves them or admits later receipts.
public static class ConsultationCredit
{
    public static decimal? Target(Consultation c) => c.FinalAmount
        ?? (c.State == "Confirmed" && c.FinancialChoice == "Prepayment" ? c.Service.ReferencePrice : null);
    public static decimal Remaining(Consultation c) => c.NoDebtReason is not null || c.SettlementId is not null ? 0 : Math.Max(0, (Target(c) ?? 0) - c.SettledAmount);
    public static bool OpenPrepayment(Consultation c) => c.State == "Confirmed" && c.FinancialChoice == "Prepayment" && Remaining(c) > 0;
    public static bool Payable(Consultation c) => c.NoDebtReason is null && Target(c) > 0
        && Remaining(c) > 0 && (c.State == "Performed" || c.State == "Confirmed" && c.FinancialChoice == "Prepayment");

    public static decimal ExternalApplied(ConsultationData data, Consultation c)
    {
        var sources = data.Entries.ToDictionary(e => e.Id);
        return data.Entries.Where(e => e.ConsultationId == c.Id && e.Kind == "Settlement").Sum(debit =>
        {
            var returned = data.Entries.Where(e => e.Kind == "SettlementReturn" && e.OriginalId == debit.Id)
                .SelectMany(e => e.Allocations ?? []).GroupBy(p => p.ReceiptId).ToDictionary(g => g.Key, g => g.Sum(p => p.Amount));
            return (debit.Allocations ?? []).Where(p => !sources.TryGetValue(p.ReceiptId, out var source) || source.ConsultationId != c.Id)
                .Sum(p => Math.Max(0, p.Amount - returned.GetValueOrDefault(p.ReceiptId)));
        });
    }

    public static Consultation Authorize(ConsultationData data, Consultation c, ConsultationActor actor, DateTimeOffset now,
        string phase, bool allowed)
    {
        if (!actor.IsManager) throw new IdentityProblem(403, "A autorização exige um gestor.");
        if (allowed && (c.NoDebtReason is not null || c.State is not ("Confirmed" or "Performed")
            || phase == "Approval" && c.FinancialChoice != "Prepayment" || Target(c) is <= 0))
            throw new IdentityProblem(400, "A autorização exige uma consulta a pagamento.");
        var maximum = allowed ? Math.Max(0, Math.Min(data.Balance(c.PersonId), Target(c) is null ? data.Balance(c.PersonId) : Remaining(c))) : 0;
        var sources = maximum > 0 ? CreditLedger.Allocate(data, c.PersonId, maximum) : [];
        return c with { CreditAuthorizations = [..c.CreditAuthorizations, new(Guid.NewGuid().ToString(), actor.AccountId, now, phase, allowed, sources)] };
    }

    private static Dictionary<string, decimal> Limits(ConsultationData data, Consultation c)
    {
        return CreditLedger.AuthorizationLimits(data, c.CreditAuthorizations.LastOrDefault());
    }

    public static decimal Available(ConsultationData data, Consultation c)
    {
        if (!Payable(c)) return 0;
        var limits = Limits(data, c);
        var available = CreditLedger.Available(data, c.PersonId);
        return Math.Max(0, Math.Min(Remaining(c), Math.Min(data.Balance(c.PersonId),
            limits.Sum(p => Math.Min(p.Value, Math.Max(0, available.GetValueOrDefault(p.Key)))))));
    }
    public static Consultation Use(ConsultationData data, Consultation c, ConsultationActor actor, DateTimeOffset now, decimal? amount)
    {
        if (actor.IsManager || actor.PersonId != c.PersonId) throw new IdentityProblem(403, "Esta opção pertence ao cliente da consulta.");
        if (c.State == "Confirmed" && c.AcceptedAt is null) throw new IdentityProblem(409, "Aceita primeiro as condições da marcação.");
        if (amount is null || amount <= 0 || amount > Available(data, c))
            throw new IdentityProblem(409, "O valor excede o crédito autorizado ainda disponível ou o valor por pagar.");
        return Apply(data, c, actor, now, amount.Value, Limits(data, c), c.CreditAuthorizations.Last().Id);
    }
    public static Consultation Settle(ConsultationData data, Consultation c, ConsultationActor actor, DateTimeOffset now, decimal? amount)
    {
        if (!actor.IsManager) throw new IdentityProblem(403, "A liquidação exige um gestor.");
        return Apply(data, c, actor, now, amount ?? Remaining(c));
    }
    public static Consultation SettleContributionReceipt(ConsultationData data, Consultation c, ConsultationActor actor,
        DateTimeOffset now, CreditEntry receipt)
    {
        if (!actor.IsManager || c.State != "Performed" || c.Service.PaymentMode != "Contribution"
            || receipt.ConsultationId != c.Id || receipt.PersonId != c.PersonId || receipt.Kind != "Receipt" || c.FinalAmount != receipt.Amount)
            throw new IdentityProblem(409, "O recebimento não corresponde à contribuição desta consulta.");
        return Apply(data, c, actor, now, receipt.Amount, new Dictionary<string, decimal> { [receipt.Id] = receipt.Amount });
    }
    private static Consultation Apply(ConsultationData data, Consultation c, ConsultationActor actor, DateTimeOffset now, decimal amount,
        IReadOnlyDictionary<string, decimal>? limits = null, string? authorizationId = null)
    {
        if (!Payable(c) || amount <= 0 || amount > 1000000m || decimal.Round(amount, 2) != amount || amount > Remaining(c))
            throw new IdentityProblem(409, "Indica um valor positivo até ao montante por pagar de uma marcação pré-paga ou consulta realizada.");
        var id = CreditLedger.Settle(data, c.PersonId, amount, actor, now, "Consultation", c.Id, c.Id, limits, authorizationId);
        var paid = amount == Remaining(c);
        return c with { SettledAmount = c.SettledAmount + amount, SettlementId = paid ? id : null,
            ExpectationOpen = !paid && c.ExpectationOpen,
            AdvanceSatisfiedAt = paid && c.FinancialChoice == "Prepayment" ? c.AdvanceSatisfiedAt ?? now : c.AdvanceSatisfiedAt,
            AdvanceSatisfiedBalance = paid && c.FinancialChoice == "Prepayment" ? data.Balance(c.PersonId) : c.AdvanceSatisfiedBalance };
    }

    // Compensating entries preserve every original settlement and restore its original credit sources.
    public static Consultation Reconcile(ConsultationData data, Consultation c, ConsultationActor actor, DateTimeOffset now, decimal target)
    {
        var excess = Math.Max(0, c.SettledAmount - target);
        if (excess == 0) return c with { SettlementId = target > 0 && c.SettledAmount >= target ? c.SettlementId
            ?? data.Entries.Last(e => e.ConsultationId == c.Id && e.Kind == "Settlement").Id : null };
        var restored = 0m;
        var returns = new List<CreditEntry>();
        foreach (var debit in CreditLedger.Ordered(data, c.PersonId).Where(e => e.ConsultationId == c.Id && e.Kind == "Settlement").Reverse().ToArray())
        {
            var previous = data.Entries.Where(e => e.Kind == "SettlementReturn" && e.OriginalId == debit.Id)
                .SelectMany(e => e.Allocations ?? []).GroupBy(p => p.ReceiptId).ToDictionary(g => g.Key, g => g.Sum(p => p.Amount));
            var left = Math.Min(excess - restored, -debit.Amount - previous.Values.Sum());
            if (left <= 0) continue;
            var parts = new List<CreditAllocation>();
            foreach (var part in debit.Allocations ?? [])
            {
                var value = Math.Min(left - parts.Sum(p => p.Amount), Math.Max(0, part.Amount - previous.GetValueOrDefault(part.ReceiptId)));
                if (value > 0) parts.Add(new(part.ReceiptId, value));
            }
            var returned = parts.Sum(p => p.Amount);
            if (returned != left) throw new IdentityProblem(409, "A liquidação exige revisão do histórico antes da reposição do crédito.");
            returns.Add(new(Guid.NewGuid().ToString(), c.PersonId, c.Id, "SettlementReturn", returned, actor.AccountId, now,
                debit.Id, "Credit", null, Origin: "Consultation", OriginReference: c.Id, Allocations: parts.ToArray(), Sequence: CreditLedger.NextSequence(data) + returns.Count));
            restored += returned;
            if (restored == excess) break;
        }
        if (restored != excess) throw new IdentityProblem(409, "Não foi possível conferir todo o crédito a repor.");
        data.Entries.AddRange(returns);
        var settled = c.SettledAmount - restored;
        return c with { SettledAmount = settled, SettlementId = target > 0 && settled >= target ? c.SettlementId
            ?? data.Entries.Last(e => e.ConsultationId == c.Id && e.Kind == "Settlement").Id : null };
    }
}
