using PaCT.Api.Finance;

namespace PaCT.Api.Consultations;

public static class FinanceReports
{
    public static object Create(ConsultationData data, DateTimeOffset now, string? personId = null, DateTimeOffset? from = null,
        DateTimeOffset? to = null, string? origin = null, string? kind = null, IReadOnlyList<Expense>? expenses = null)
    {
        bool Period(DateTimeOffset date) => (from is null || date >= from) && (to is null || date < to);
        var entries = data.Entries.Where(e => (personId is null || e.PersonId == personId) && (origin is null || e.Origin == origin) && (kind is null || e.Kind == kind)).ToArray();
        var receipts = entries.Where(e => e.Kind == "Receipt" && Period(e.EffectiveAt ?? e.CreatedAt)).ToArray();
        var refunds = entries.Where(e => e.Kind == "Refund" && Period(e.EffectiveAt ?? e.CreatedAt)).ToArray();
        var settlements = entries.Where(e => e.Kind == "Settlement" && Period(e.CreatedAt)).ToArray();
        var settlementReturns = entries.Where(e => e.Kind == "SettlementReturn" && Period(e.CreatedAt)).Sum(e => e.Amount);
        var performed = data.Consultations.Where(c => (personId is null || c.PersonId == personId) && c.State == "Performed").ToArray();
        var consultations = performed.Where(c => Period(c.StartsAt)).ToArray();
        var unpaid = performed.Where(ConsultationRules.HasDebt).ToArray();
        var packDebts = data.Packs.Where(p => (personId is null || p.PersonId == personId) && !SessionPacks.IsPaid(p)).ToArray();
        var participations = data.Participations.Where(p => personId is null || p.PersonId == personId).ToArray();
        var eventDebts = participations.Select(p => GroupEvents.AmountDue(data, p)).Where(amount => amount > 0).ToArray();
        var anonymous = personId is null && origin is null or "EventService" && kind is null or "Receipt" ? data.EventCash.Where(e => Period(e.EffectiveAt)).Sum(e => e.Amount) : 0;
        var sales = origin is null or "Sale" && kind is null or "Receipt"
            ? data.Sales.Where(s => (personId is null || s.PersonId == personId) && Period(s.EffectiveAt)).Sum(s => s.Total) : 0;
        var received = receipts.Sum(e => e.Amount) + anonymous + sales;
        var refunded = -refunds.Sum(e => e.Amount);
        var businessScope = personId is null && origin is null && kind is null;
        var packs = data.Packs.Where(p => (personId is null || p.PersonId == personId) && SessionPacks.IsPaid(p)).ToArray();
        return new { asOf = now, from, to, businessScope,
            received, saleReceipts = sales, salesPrepared = data.SalesReady, anonymousEventReceipts = anonymous, refunded,
            receiptOrigins = receipts.GroupBy(e => e.Origin).Select(group => new { origin = group.Key, amount = group.Sum(e => e.Amount) }).ToArray(),
            spending = businessScope && expenses is not null ? ExpenseSpending(expenses, Period, received - refunded, data.SalesReady) : null,
            settled = -settlements.Sum(e => e.Amount) - settlementReturns, settlementReturns,
            corrections = entries.Where(e => (e.Kind is "Adjustment" or "AdjustmentReversal" or "Reversal") && Period(e.CreatedAt)).Sum(e => e.Amount),
            globalNegativeDebt = data.Entries.Where(e => personId is null || e.PersonId == personId).GroupBy(e => e.PersonId).Sum(g => Math.Max(0, -g.Sum(e => e.Amount))),
            availableBalance = data.Entries.Where(e => personId is null || e.PersonId == personId).GroupBy(e => e.PersonId).Sum(g => Math.Max(0, g.Sum(e => e.Amount))),
            netBalance = data.Entries.Where(e => personId is null || e.PersonId == personId).Sum(e => e.Amount),
            paidConsultations = consultations.Count(c => c.SettlementId is not null && !ConsultationRules.HasDebt(c)), unpaidConsultations = unpaid.Length,
            pendingContributions = unpaid.Count(c => c.Service.PaymentMode == "Contribution") + participations.Count(ClientAgenda.UndefinedDebt),
            undefinedContributions = unpaid.Count(c => c.FinalAmount is null) + participations.Count(ClientAgenda.UndefinedDebt),
            activeCollectionAmount = unpaid.Where(c => !c.OldDebt).Sum(ConsultationRules.Remaining),
            oldDebtAmount = unpaid.Where(c => c.OldDebt).Sum(ConsultationRules.Remaining),
            totalUnpaid = unpaid.Sum(ConsultationRules.Remaining), noDebtConsultations = consultations.Count(c => c.NoDebtReason is not null),
            unpaidPackPurchases = packDebts.Length, unpaidPackAmount = packDebts.Sum(p => p.Amount), unpaidEventParticipations = eventDebts.Length, unpaidEventAmount = eventDebts.Sum(),
            retreatRestitutionsPending = data.Participations.Where(p => (personId is null || p.PersonId == personId) && p.ReturnDue is not null).Sum(p => Math.Max(0, p.ReturnDue!.Value - RetreatFinance.Returned(p))),
            creditRestored = entries.Where(e => e.Kind == "Restitution" && Period(e.EffectiveAt ?? e.CreatedAt)).Sum(e => e.Amount),
            freeConsultations = consultations.Count(c => c.NoDebtReason == "Free"), giftConsultations = consultations.Count(c => c.NoDebtReason == "Gift"),
            packConsultations = consultations.Count(c => c.FinancialChoice == "Pack"),
            packSessionsPurchased = packs.Where(p => Period(p.PurchasedAt)).Sum(p => p.Sessions),
            packSessionsAvailable = packs.Sum(p => SessionPacks.Remaining(data, p.Id)),
            packSessionsUsed = data.PackUses.Count(u => (personId is null || u.PersonId == personId) && Period(u.CreatedAt)
                && u.ReversesId is null && !data.PackUses.Any(r => r.ReversesId == u.Id)),
            legacyReceiptDates = receipts.Count(e => e.EffectiveAt is null),
            description = "Entradas e devoluções são apuradas pela data efetiva. Os pagamentos de despesas e investimentos usam a data da fatura ou, na sua ausência, a data efetiva do pagamento. A data da consulta serve apenas para os indicadores de atividade. Saldos e dívidas mostram a situação atual."
        };
    }

    private static object ExpenseSpending(IReadOnlyList<Expense> expenses, Func<DateTimeOffset, bool> period, decimal netReceipts, bool salesReady)
    {
        var known = expenses.Where(e => period(AgendaRules.Midnight(e.InvoiceDate ?? e.Date))).ToArray();
        var lines = known.SelectMany(e => e.Lines).ToArray();
        decimal operating = 0, investment = 0, mixed = 0;
        foreach (var expense in expenses)
        {
            var paid = expense.Payments.Where(p => period(expense.InvoiceDate is DateOnly invoice ? AgendaRules.Midnight(invoice) : p.EffectiveAt))
                .Sum(p => p.Amount);
            if (expense.Investments == 0) operating += paid;
            else if (expense.Investments == expense.Total) investment += paid;
            else if (paid == expense.Total)
            {
                operating += expense.Total - expense.Investments;
                investment += expense.Investments;
            }
            else mixed += paid;
        }
        return new
        {
            knownExpenses = lines.Where(l => l.Kind == "Expense").Sum(l => l.Total),
            knownInvestments = lines.Where(l => l.Kind == "Investment").Sum(l => l.Total),
            outstanding = known.Sum(e => e.Remaining),
            operatingPayments = operating, investmentPayments = investment, unclassifiedPayments = mixed,
            paid = operating + investment + mixed,
            resultBeforeInvestments = salesReady && mixed == 0 ? netReceipts - operating : (decimal?)null,
            resultAfterInvestments = salesReady ? netReceipts - operating - investment - mixed : (decimal?)null,
            categories = lines.GroupBy(l => (l.Kind, l.CategoryId)).Select(group => new
            {
                kind = group.Key.Kind, name = group.OrderBy(l => l.CategoryName, StringComparer.Ordinal).First().CategoryName,
                amount = group.Sum(l => l.Total)
            }).OrderBy(l => l.kind).ThenBy(l => l.name).ToArray()
        };
    }
}
