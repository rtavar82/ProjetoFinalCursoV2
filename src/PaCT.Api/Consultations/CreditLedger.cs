using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public static class CreditLedger
{
    public static IOrderedEnumerable<CreditEntry> Ordered(ConsultationData data, string personId) => data.Entries.Where(e => e.PersonId == personId)
        .OrderBy(e => e.Sequence == 0 ? 0 : 1).ThenBy(e => e.Sequence).ThenBy(e => e.CreatedAt).ThenBy(e => e.Id);

    // Sources trace uses, not reservations. Exceptional deficits absorb subsequent inflows first.
    public static Dictionary<string, decimal> Available(ConsultationData data, string personId)
    {
        var available = new Dictionary<string, decimal>();
        var debits = new Dictionary<string, CreditAllocation[]>();
        decimal deficit = 0;
        foreach (var e in Ordered(data, personId))
        {
            if (e.Amount > 0)
            {
                var absorbed = Math.Min(deficit, e.Amount); deficit -= absorbed;
                var remainder = e.Amount - absorbed;
                if (e.Kind == "Reversal" && e.OriginalId is not null && debits.TryGetValue(e.OriginalId, out var restored))
                    foreach (var part in restored)
                    {
                        var value = Math.Min(remainder, part.Amount);
                        available[part.ReceiptId] = available.GetValueOrDefault(part.ReceiptId) + value; remainder -= value;
                    }
                if (remainder > 0) available[e.Id] = available.GetValueOrDefault(e.Id) + remainder;
            }
            else
            {
                var allocations = e.Allocations ?? Take(available, -e.Amount);
                decimal consumed = 0;
                foreach (var part in allocations)
                {
                    var value = Math.Min(Math.Max(0, available.GetValueOrDefault(part.ReceiptId)), part.Amount);
                    available[part.ReceiptId] = available.GetValueOrDefault(part.ReceiptId) - value; consumed += value;
                }
                deficit += -e.Amount - consumed; debits[e.Id] = allocations;
            }
        }
        return available;
    }
    public static CreditAllocation[] Allocate(ConsultationData data, string person, decimal amount)
    {
        var parts = Take(Available(data, person), amount);
        if (data.Balance(person) < amount || parts.Sum(p => p.Amount) != amount)
            throw new IdentityProblem(409, "Saldo insuficiente. Não foi alterado o saldo.");
        return parts;
    }
    private static CreditAllocation[] Take(Dictionary<string, decimal> available, decimal amount)
    {
        var result = new List<CreditAllocation>();
        foreach (var (id, balance) in available)
        {
            var part = Math.Min(amount, Math.Max(0, balance));
            if (part == 0) continue;
            result.Add(new(id, part)); amount -= part;
            if (amount == 0) break;
        }
        return result.ToArray();
    }
    public static Dictionary<string, decimal> RunningBalances(ConsultationData data, string person)
    {
        decimal balance = 0;
        return Ordered(data, person).ToDictionary(e => e.Id, e => balance += e.Amount);
    }
    public static long NextSequence(ConsultationData data) => data.Entries.Select(e => e.Sequence).DefaultIfEmpty().Max() + 1;
}
