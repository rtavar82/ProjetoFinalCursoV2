using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public static class CreditLedger
{
    public static Dictionary<string, decimal> AuthorizationLimits(ConsultationData data, ConsultationCreditAuthorization? authorization)
    {
        if (authorization is not { Allowed: true }) return [];
        var used = data.Entries.Where(e => e.AuthorizationId == authorization.Id && e.Kind == "Settlement")
            .SelectMany(e => e.Allocations ?? []).GroupBy(p => p.ReceiptId).ToDictionary(g => g.Key, g => g.Sum(p => p.Amount));
        return authorization.Sources.ToDictionary(p => p.ReceiptId, p => Math.Max(0, p.Amount - used.GetValueOrDefault(p.ReceiptId)));
    }

    public static string Settle(ConsultationData data, string person, decimal amount, ConsultationActor actor, DateTimeOffset now,
        string origin, string reference, string? consultationId = null, IReadOnlyDictionary<string, decimal>? limits = null, string? authorizationId = null)
    {
        var allocations = Allocate(data, person, amount, limits);
        var id = Guid.NewGuid().ToString();
        data.Entries.Add(new(id, person, consultationId, "Settlement", -amount, actor.AccountId, now, null, "Credit", null,
            Origin: origin, OriginReference: reference, Allocations: allocations, Sequence: NextSequence(data), AuthorizationId: authorizationId));
        return id;
    }

    public static void Restore(ConsultationData data, string person, string origin, string reference, decimal excess,
        ConsultationActor actor, DateTimeOffset now, string? consultationId = null)
    {
        if (excess <= 0) return;
        decimal restored = 0;
        var returns = new List<CreditEntry>();
        foreach (var debit in Ordered(data, person).Where(e => e.Kind == "Settlement" && e.Origin == origin && e.OriginReference == reference).Reverse().ToArray())
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
            if (parts.Sum(p => p.Amount) != left) throw new IdentityProblem(409, "A liquidação exige revisão do histórico antes da reposição do crédito.");
            returns.Add(new(Guid.NewGuid().ToString(), person, consultationId, "SettlementReturn", left, actor.AccountId, now,
                debit.Id, "Credit", null, Origin: origin, OriginReference: reference, Allocations: parts.ToArray(), Sequence: NextSequence(data) + returns.Count));
            restored += left;
            if (restored == excess) break;
        }
        if (restored != excess) throw new IdentityProblem(409, "Não foi possível conferir todo o crédito a repor.");
        data.Entries.AddRange(returns);
    }
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
                if (e.Kind is "Reversal" or "SettlementReturn" && e.OriginalId is not null && debits.TryGetValue(e.OriginalId, out var originalParts))
                {
                    var restored = e.Allocations ?? originalParts;
                    foreach (var part in restored)
                    {
                        var value = Math.Min(remainder, part.Amount);
                        available[part.ReceiptId] = available.GetValueOrDefault(part.ReceiptId) + value; remainder -= value;
                    }
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
    public static CreditAllocation[] Allocate(ConsultationData data, string person, decimal amount, IReadOnlyDictionary<string, decimal>? limits = null)
    {
        var available = Available(data, person);
        if (limits is not null)
            foreach (var key in available.Keys.ToArray()) available[key] = Math.Min(available[key], Math.Max(0, limits.GetValueOrDefault(key)));
        var parts = Take(available, amount);
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
