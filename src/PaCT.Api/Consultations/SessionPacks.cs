using System.Text.Json.Serialization;
using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public sealed record PackPurchaseInput(string PersonId, string Title, int Sessions, decimal Amount,
    [property: JsonConverter(typeof(ExplicitInstantConverter))] DateTimeOffset PurchasedAt, string[] ServiceIds,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] decimal? RegularTotal = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull), JsonConverter(typeof(OptionalExplicitInstantConverter))] DateTimeOffset? ValidUntil = null);
public sealed record PackDecision(string Action, string AuthorId, DateTimeOffset At, string? ReasonCiphertext = null, int? PreviousMonths = null, int? NewMonths = null,
    int? Quantity = null, DateTimeOffset? PreviousValidity = null, DateTimeOffset? NewValidity = null);
public sealed record SessionPack(string Id, string PersonId, string Title, int Sessions, decimal Amount, DateTimeOffset PurchasedAt,
    string[] ServiceIds, string CreatedBy, long Version = 1, bool EarlyUseAuthorized = false, string? SettlementId = null,
    int ExtensionMonths = 0, PackDecision[]? History = null, DateTimeOffset? ValidUntil = null, decimal? RegularTotal = null);
public sealed record PackUse(string Id, string PackId, string PersonId, string ActivityId, string ServiceId,
    string ActivityKind, DateTimeOffset ActivityAt, string AuthorId, DateTimeOffset CreatedAt, string? ReversesId = null, string? ReasonCiphertext = null);
public sealed record PackNotice(string Id, string PackId, string PersonId, string Kind, DateTimeOffset DueAt, DateTimeOffset ExpiresAt,
    DateTimeOffset? ReadAt = null, bool Cancelled = false, DateTimeOffset? ManagerReadAt = null, DateTimeOffset? EmailQueuedAt = null);

public static class SessionPacks
{
    private static void Require(bool valid, string message, int status = 400) { if (!valid) throw new IdentityProblem(status, message); }
    // The communicated year is a review reference, never an automatic cutoff.
    public static DateTimeOffset ExpiresAt(SessionPack pack) => AgendaRules.Midnight(AgendaRules.LocalDate(pack.PurchasedAt).AddMonths(PackPolicy.ValidityMonths).AddDays(1));
    public static int Remaining(ConsultationData data, string id) => data.Packs.Single(p => p.Id == id).Sessions
        - data.PackUses.Count(u => u.PackId == id && u.ReversesId is null && !data.PackUses.Any(r => r.ReversesId == u.Id))
        - (data.Packs.Single(p => p.Id == id).History ?? []).Where(h => h.Action == "WithdrawPackSessions").Sum(h => h.Quantity ?? 0);
    public static bool CanUse(ConsultationData data, SessionPack pack, string serviceId, DateTimeOffset at) =>
        pack.ServiceIds.Contains(serviceId) && pack.SettlementId is not null
        && !ActivityCatalogue.Complete(data.Services).Any(s => s.Id == serviceId && s.ServiceKind == "Retreat")
        && at >= pack.PurchasedAt && Remaining(data, pack.Id) > 0;
    public static void Consume(ConsultationData data, string packId, string personId, string activityId, string serviceId,
        string activityKind, DateTimeOffset activityAt, ConsultationActor actor, DateTimeOffset now)
    {
        Require(actor.IsManager, "Esta ação exige a gestora-terapeuta.", 403);
        var pack = data.Packs.SingleOrDefault(p => p.Id == packId && p.PersonId == personId) ?? throw new IdentityProblem(409, "Seleciona um pack desta pessoa.");
        Require(!data.PackUses.Any(u => u.ActivityId == activityId && u.ReversesId is null && !data.PackUses.Any(r => r.ReversesId == u.Id)), "Esta atividade já consumiu uma sessão.", 409);
        Require(CanUse(data, pack, serviceId, activityAt), "O pack não pode cobrir esta atividade. Verifica compatibilidade, validade, sessões e autorização.", 409);
        data.PackUses.Add(new(Guid.NewGuid().ToString(), pack.Id, personId, activityId, serviceId, activityKind, activityAt, actor.AccountId, now));
        Save(data, pack with { Version = pack.Version + 1 });
    }
    public static ConsultationResult Apply(ConsultationData data, ConsultationCommand input, ConsultationActor actor, DateTimeOffset now, Func<string, string, string, string> encrypt)
    {
        if (input.Action == "PurchasePack")
        {
            Require(actor.IsManager, "Esta ação exige a gestora-terapeuta.", 403);
            var purchase = input.PackPurchase ?? throw new IdentityProblem(400, "Preenche a compra do pack.");
            Require(Guid.TryParse(purchase.PersonId, out _) && purchase.Sessions is >= 1 and <= 1000 && Money(purchase.Amount), "Indica a pessoa, o número de sessões e o valor total.");
            Require(purchase.PurchasedAt > DateTimeOffset.UnixEpoch && purchase.PurchasedAt <= now, "Indica uma data de compra já ocorrida.");
            Require(purchase.ServiceIds is { Length: > 0 and <= 100 } && purchase.ServiceIds.Distinct().Count() == purchase.ServiceIds.Length
                && purchase.ServiceIds.All(id => ActivityCatalogue.Complete(data.Services).Any(s => s.Id == id && s.Active && s.ServiceKind != "Retreat" && s.PaymentMode != "Free" && !SharingWorkshop.Matches(s.Title))), "Seleciona serviços individuais ou de grupo pagos. Retiros não admitem packs.");
            var regular = purchase.RegularTotal ?? (purchase.ServiceIds.Length == 1 ? ActivityCatalogue.Complete(data.Services).Single(s => s.Id == purchase.ServiceIds[0]).ReferencePrice * purchase.Sessions : null);
            Require(regular is > 0 && Money(regular.Value) && purchase.Amount < regular, "Indica o valor das mesmas sessões avulso. O preço promocional tem de ser inferior.");
            Require(purchase.ValidUntil is null || purchase.ValidUntil > purchase.PurchasedAt, "A data de revisão deve ser posterior à compra.");
            var allocations = CreditLedger.Allocate(data, purchase.PersonId, purchase.Amount);
            var settlement = Guid.NewGuid().ToString();
            var pack = new SessionPack(Guid.NewGuid().ToString(), purchase.PersonId, IdentityValidation.Required(purchase.Title, 200, "o nome do pack"),
                purchase.Sessions, purchase.Amount, purchase.PurchasedAt.ToUniversalTime(), purchase.ServiceIds, actor.AccountId,
                SettlementId: settlement, ValidUntil: purchase.ValidUntil, RegularTotal: regular);
            data.Entries.Add(new(settlement, pack.PersonId, null, "Settlement", -pack.Amount, actor.AccountId, now, null, "Credit", null,
                Origin: "Pack", OriginReference: pack.Id, Allocations: allocations, Sequence: CreditLedger.NextSequence(data)));
            data.Packs.Add(pack); return new(pack.Id, "Compra integral registada. As sessões ficaram disponíveis.");
        }
        var current = data.Packs.SingleOrDefault(p => p.Id == input.Id && (actor.IsManager || p.PersonId == actor.PersonId)) ?? throw new IdentityProblem(404, "Pack não encontrado.");
        Require(current.Version == input.Version, "O pack mudou. Revê a informação atual.", 409);
        var next = current;
        if (input.Action == "SettlePack")
        {
            Require(actor.IsManager, "A compra do pack exige um gestor.", 403);
            Require(current.SettlementId is null, "Esta compra já foi liquidada.", 409);
            Require(input.Amount is null || input.Amount == current.Amount, "A compra só pode ser liquidada integralmente.", 409);
            var allocations = CreditLedger.Allocate(data, current.PersonId, current.Amount); var id = Guid.NewGuid().ToString();
            data.Entries.Add(new(id, current.PersonId, null, "Settlement", -current.Amount, actor.AccountId, now, null, "Credit", null,
                Origin: "Pack", OriginReference: current.Id, Allocations: allocations, Sequence: CreditLedger.NextSequence(data)));
            next = current with { SettlementId = id };
        }
        else
        {
            Require(actor.IsManager, "Esta ação exige a gestora-terapeuta.", 403);
            var reason = IdentityValidation.Required(input.Reason, 2000, "o motivo da decisão");
            var encrypted = encrypt(current.Id, "pack-reason", reason);
            if (input.Action == "AuthorizePackUse")
            {
                throw new IdentityProblem(409, "O pack só pode ser utilizado depois da compra integral.");
            }
            else if (input.Action is "ExtendPack" or "SetPackValidity")
            {
                var date = input.Action == "ExtendPack" ? (current.ValidUntil ?? ExpiresAt(current)).AddMonths(input.ExtensionMonths ?? 0) : input.ValidUntil;
                Require(input.Action != "ExtendPack" || input.ExtensionMonths is >= 1 and <= 120, "Indica os meses de prorrogação.");
                Require(date is null || date > current.PurchasedAt, "A data de revisão deve ser posterior à compra.");
                next = current with { ValidUntil = date };
            }
            else if (input.Action == "WithdrawPackSessions")
            {
                Require(input.Quantity is > 0 && input.Quantity <= Remaining(data, current.Id), "Indica quantas sessões disponíveis pretendes retirar.");
            }
            else if (input.Action == "ReversePackUse")
            {
                var usage = data.PackUses.SingleOrDefault(u => u.Id == input.PackUseId && u.PackId == current.Id && u.ReversesId is null) ?? throw new IdentityProblem(404, "Consumo não encontrado.");
                Require(!data.PackUses.Any(u => u.ReversesId == usage.Id), "Este consumo já foi reposto.", 409);
                data.PackUses.Add(new(Guid.NewGuid().ToString(), current.Id, current.PersonId, usage.ActivityId, usage.ServiceId, usage.ActivityKind,
                    usage.ActivityAt, actor.AccountId, now, usage.Id, encrypted));
            }
            else throw new IdentityProblem(400, "Ação de pack inválida.");
            next = next with { History = [..current.History ?? [], new(input.Action, actor.AccountId, now, encrypted, current.ExtensionMonths, next.ExtensionMonths,
                input.Action == "WithdrawPackSessions" ? input.Quantity : null, current.ValidUntil, next.ValidUntil)] };
        }
        Save(data, next with { Version = current.Version + 1 }); Advance(data, now); return new(current.Id, "Pack atualizado.");
    }
    public static void Advance(ConsultationData data, DateTimeOffset now)
    {
        foreach (var pack in data.Packs)
        {
            var end = ExpiresAt(pack); var remaining = Remaining(data, pack.Id);
            foreach (var item in new[] {
                (Kind: "PackExpiry:two-months:0", Due: AgendaRules.Midnight(AgendaRules.LocalDate(end).AddMonths(-PackPolicy.ReminderMonthsBeforeExpiry)), Until: end),
                (Kind: "PackManager:Annual", Due: end, Until: DateTimeOffset.MaxValue),
                (Kind: "PackManager:Validity:" + pack.ValidUntil?.ToString("O"), Due: pack.ValidUntil ?? DateTimeOffset.MaxValue, Until: DateTimeOffset.MaxValue) })
            {
                if (pack.SettlementId is not null && remaining > 0 && item.Due <= now && now < item.Until && !data.PackNotices.Any(n => n.PackId == pack.Id && n.Kind == item.Kind))
                    data.PackNotices.Add(new(Guid.NewGuid().ToString(), pack.Id, pack.PersonId, item.Kind, item.Due, item.Until));
            }
            for (var index = 0; index < data.PackNotices.Count; index++)
            {
                var notice = data.PackNotices[index];
                if (notice.PackId == pack.Id && !notice.Cancelled && (remaining == 0 || now >= notice.ExpiresAt || notice.Kind.StartsWith("Pack3Months", StringComparison.Ordinal)
                    || notice.Kind.StartsWith("PackManager:Validity:") && notice.Kind != "PackManager:Validity:" + pack.ValidUntil?.ToString("O")))
                    data.PackNotices[index] = notice with { Cancelled = true };
            }
        }
    }
    private static void Save(ConsultationData data, SessionPack pack) => data.Packs[data.Packs.FindIndex(p => p.Id == pack.Id)] = pack;
    private static bool Money(decimal amount) => amount is >= .01m and <= 1000000m && decimal.Round(amount, 2) == amount;
}
