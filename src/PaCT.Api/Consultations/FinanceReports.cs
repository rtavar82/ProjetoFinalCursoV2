namespace PaCT.Api.Consultations;

public static class FinanceReports
{
    public static object Create(ConsultationData data, DateTimeOffset now, string? personId = null, DateTimeOffset? from = null,
        DateTimeOffset? to = null, string? origin = null, string? kind = null)
    {
        bool Period(DateTimeOffset date) => (from is null || date >= from) && (to is null || date < to);
        var entries = data.Entries.Where(e => (personId is null || e.PersonId == personId) && (origin is null || e.Origin == origin) && (kind is null || e.Kind == kind)).ToArray();
        var receipts = entries.Where(e => e.Kind == "Receipt" && Period(e.EffectiveAt ?? e.CreatedAt)).ToArray();
        var refunds = entries.Where(e => e.Kind == "Refund" && Period(e.EffectiveAt ?? e.CreatedAt)).ToArray();
        var settlements = entries.Where(e => e.Kind == "Settlement" && Period(e.CreatedAt)).ToArray();
        var consultations = data.Consultations.Where(c => (personId is null || c.PersonId == personId) && Period(c.StartsAt) && c.State == "Performed").ToArray();
        var unpaid = consultations.Where(ConsultationRules.HasDebt).ToArray();
        var packDebts = data.Packs.Where(p => (personId is null || p.PersonId == personId) && p.SettlementId is null && Period(p.PurchasedAt)).ToArray();
        var eventDebts = data.Participations.Where(p => (personId is null || p.PersonId == personId) && GroupEvents.AmountDue(data, p) > 0
            && Period(data.Events.Single(e => e.Id == p.EventId).Definition.StartsAt)).ToArray();
        var anonymous = personId is null && origin is null or "EventService" && kind is null or "Receipt" ? data.EventCash.Where(e => Period(e.EffectiveAt)).Sum(e => e.Amount) : 0;
        return new { asOf = now, from, to,
            received = receipts.Sum(e => e.Amount) + anonymous, anonymousEventReceipts = anonymous, refunded = -refunds.Sum(e => e.Amount), settled = -settlements.Sum(e => e.Amount),
            corrections = entries.Where(e => (e.Kind is "Adjustment" or "AdjustmentReversal" or "Reversal") && Period(e.CreatedAt)).Sum(e => e.Amount),
            globalNegativeDebt = data.Entries.Where(e => personId is null || e.PersonId == personId).GroupBy(e => e.PersonId).Sum(g => Math.Max(0, -g.Sum(e => e.Amount))),
            availableBalance = data.Entries.Where(e => personId is null || e.PersonId == personId).GroupBy(e => e.PersonId).Sum(g => Math.Max(0, g.Sum(e => e.Amount))),
            netBalance = data.Entries.Where(e => personId is null || e.PersonId == personId).Sum(e => e.Amount),
            paidConsultations = consultations.Count(c => c.SettlementId is not null), unpaidConsultations = unpaid.Length,
            pendingContributions = unpaid.Count(c => c.Service.PaymentMode == "Contribution"), undefinedContributions = unpaid.Count(c => c.FinalAmount is null),
            activeCollectionAmount = unpaid.Where(c => !c.CollectionClosed).Sum(c => c.FinalAmount ?? 0),
            closedCollectionAmount = unpaid.Where(c => c.CollectionClosed).Sum(c => c.FinalAmount ?? 0),
            totalUnpaid = unpaid.Sum(c => c.FinalAmount ?? 0), noDebtConsultations = consultations.Count(c => c.NoDebtReason is not null),
            unpaidPackPurchases = packDebts.Length, unpaidPackAmount = packDebts.Sum(p => p.Amount), unpaidEventParticipations = eventDebts.Length, unpaidEventAmount = eventDebts.Sum(p => GroupEvents.AmountDue(data, p)),
            retreatRestitutionsPending = data.Participations.Where(p => (personId is null || p.PersonId == personId) && p.ReturnDue is not null).Sum(p => Math.Max(0, p.ReturnDue!.Value - RetreatFinance.Returned(p))),
            creditRestored = entries.Where(e => e.Kind == "Restitution" && Period(e.EffectiveAt ?? e.CreatedAt)).Sum(e => e.Amount),
            freeConsultations = consultations.Count(c => c.NoDebtReason == "Free"), giftConsultations = consultations.Count(c => c.NoDebtReason == "Gift"),
            packConsultations = consultations.Count(c => c.FinancialChoice == "Pack"),
            legacyReceiptDates = receipts.Count(e => e.EffectiveAt is null),
            description = "Recebimentos e devoluções: data efetiva. Liquidações: data da utilização. Consultas: início agendado. Saldos e dívidas: situação atual na data de apuramento. Correções e compensações são apresentadas separadamente, nunca como recebimentos. A dívida global por saldo negativo é distinta da dívida das consultas."
        };
    }
}
