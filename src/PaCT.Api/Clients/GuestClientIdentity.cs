using System.Text.Json;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Clients;

public sealed record GuestIdentityDecision(ulong SourceVersion, ulong? TargetVersion = null, ulong? ReviewVersion = null, bool KeepSeparate = false);
public sealed record GuestIdentityInfo(string PersonId, ulong SourceVersion, bool HasCoincidences, ulong? ReviewVersion);

// Uses the same client session/transaction as the request. A contact match is an alert,
// never proof of identity or permission to copy profile fields.
public static class GuestClientIdentity
{
    public static async Task CreateAsync(IClientSession session, string id, GuestSubmission raw, IdentitySecurity security, DateTime now)
    {
        var input = GuestConsultations.Normalize(raw);
        var fields = new Dictionary<string, byte[]> {
            ["first-name"] = security.Encrypt(id, "first-name", input.FirstName),
            ["last-name"] = security.Encrypt(id, "last-name", input.LastName),
            ["dial-code"] = security.Encrypt(id, "dial-code", input.DialCode),
            ["phone"] = security.Encrypt(id, "phone", input.Phone)
        };
        if (input.Email is not null) fields["email"] = security.Encrypt(id, "email", input.Email);
        var row = new StoredClient(id, new(Locality: input.Locality), fields, input.Email is null ? null : security.EmailHash(input.Email),
            security.PhoneHash(input.DialCode, input.Phone), null, null, now, now, 1);
        await session.SaveClientAsync(row, true);
        var matches = Matches(await session.ClientsAsync(), row);
        if (matches.Length == 0) return;
        var reviewId = Guid.NewGuid().ToString();
        var proposal = new ClientProfile(input.FirstName, input.LastName, Locality: input.Locality, Email: input.Email, DialCode: input.DialCode, Phone: input.Phone);
        await session.SaveReviewAsync(new(reviewId, "Edit", id,
            security.Encrypt(reviewId, "review", JsonSerializer.Serialize(new ReviewProposal(proposal, "GuestRequest"))),
            matches, "Open", null, now, row.Version), true);
    }

    public static async Task<GuestIdentityInfo> DescribeAsync(IClientSession session, string personId, IdentitySecurity security)
    {
        var all = await session.ClientsAsync(); var reviews = await session.ReviewsAsync();
        var source = Resolve(all, reviews, personId);
        var guestReviews = reviews.Where(r => IsGuestReview(r, security)).ToArray();
        var matches = PendingMatches(all, guestReviews, source);
        var review = guestReviews.FirstOrDefault(r => r.PersonId == source.Id && r.Status == "Open");
        return new(source.Id, source.Version, matches.Length > 0, review?.Version);
    }

    public static async Task<string> PrepareApprovalAsync(IClientSession session, GuestConsultationRequest request,
        ConsultationCommand input, ConsultationActor actor, DateTimeOffset now, IdentitySecurity security)
    {
        if (!actor.IsManager) throw new IdentityProblem(403, "Esta ação exige um gestor.");
        if (request.Version != input.Version || !GuestConsultations.Occupies(request, now)) throw Changed();
        var all = await session.ClientsAsync(); var reviews = await session.ReviewsAsync();
        var source = Resolve(all, reviews, request.PersonId!);
        var guestReviews = reviews.Where(r => IsGuestReview(r, security)).ToArray();
        if (reviews.Any(r => r.PersonId == source.Id && r.Status == "Open" && !guestReviews.Contains(r))) throw Changed();
        var matches = PendingMatches(all, guestReviews, source);
        var review = guestReviews.FirstOrDefault(r => r.PersonId == source.Id && r.Status == "Open");
        var targetId = input.PersonId ?? source.Id;
        if (matches.Length == 0)
        {
            if (targetId != source.Id) throw new IdentityProblem(400, "Este pedido já tem ficha. Atualiza antes de escolher outra associação.");
            if (input.GuestIdentity is { } checkedIdentity && checkedIdentity.SourceVersion != source.Version) throw Changed();
            if (review is not null) await session.SaveReviewAsync(review with { Status = "Rejected", DecidedBy = actor.AccountId,
                DecidedAt = now.UtcDateTime, Version = review.Version + 1 }, false);
            // A previously reviewed association can be used without asking for it again.
            return source.Id;
        }
        var decision = input.GuestIdentity;
        ClientAggregationItem[]? aggregation = null;
        if (decision is null || !input.ConditionsAccepted)
            throw new IdentityProblem(400, "Verifica os contactos coincidentes e confirma se pertencem à mesma pessoa.");
        if (decision.SourceVersion != source.Version || decision.ReviewVersion != review?.Version) throw Changed();
        if (decision.KeepSeparate)
        {
            if (targetId != source.Id) throw new IdentityProblem(400, "Ao manter pessoas diferentes, usa a ficha deste pedido.");
        }
        else
        {
            var target = all.SingleOrDefault(p => p.IsActive && p.Id == targetId && p.Id != source.Id)
                ?? throw new IdentityProblem(400, "Escolhe a ficha da pessoa cuja identidade verificaste.");
            if (target.Version != decision.TargetVersion || target.IdentityReviewStatus == "Pending") throw Changed();
            if (source.AccountId is not null) throw new IdentityProblem(409, "Esta ficha já tem conta. Revê a associação em Clientes.");
            aggregation = await session.ConsolidateAsync(target, source, now.UtcDateTime, actor.AccountId);
        }
        if (review is not null)
            await session.SaveReviewAsync(review with { Status = decision.KeepSeparate ? "Rejected" : "Accepted",
                Proposal = security.Encrypt(review.Id, "review", JsonSerializer.Serialize(JsonSerializer.Deserialize<ReviewProposal>(security.Decrypt(review.Id, "review", review.Proposal))! with { Aggregation = aggregation })),
                PersonId = decision.KeepSeparate ? source.Id : targetId, AssociatedPersonId = decision.KeepSeparate ? null : source.Id,
                Candidates = matches, SelectedFields = [], DecidedBy = actor.AccountId, DecidedAt = now.UtcDateTime, Version = review.Version + 1 }, false);
        else
        {
            // Older requests may predate the alert. Keep the explicit identity decision auditable too.
            var id = Guid.NewGuid().ToString();
            var contact = JsonSerializer.Deserialize<GuestContact>(security.Decrypt(request.Id, "consultation-guest-contact", Convert.FromBase64String(request.ContactCiphertext)))!;
            var proposal = new ClientProfile(contact.FirstName, contact.LastName, Locality: contact.Locality, Email: contact.Email, DialCode: contact.DialCode, Phone: contact.Phone);
            await session.SaveReviewAsync(new(id, "Edit", decision.KeepSeparate ? source.Id : targetId,
                security.Encrypt(id, "review", JsonSerializer.Serialize(new ReviewProposal(proposal, "GuestRequest", aggregation))), matches,
                decision.KeepSeparate ? "Rejected" : "Accepted", actor.AccountId, now.UtcDateTime, source.Version,
                DecidedBy: actor.AccountId, DecidedAt: now.UtcDateTime, AssociatedPersonId: decision.KeepSeparate ? null : source.Id,
                SelectedFields: []), true);
        }
        if (!decision.KeepSeparate)
            foreach (var pending in reviews.Where(r => r.Id != review?.Id && r.Status == "Open" && r.Candidates.Contains(source.Id)))
            {
                var candidates = pending.Candidates.Select(id => id == source.Id ? targetId : id)
                    .Where(id => id != pending.PersonId).Distinct().ToArray();
                await session.SaveReviewAsync(pending with { Candidates = candidates, Status = candidates.Length == 0 ? "Rejected" : "Open",
                    DecidedBy = candidates.Length == 0 ? actor.AccountId : null, DecidedAt = candidates.Length == 0 ? now.UtcDateTime : null,
                    Version = pending.Version + 1 }, false);
            }
        return targetId;
    }

    private static string[] Matches(IReadOnlyList<StoredClient> all, StoredClient source) => all
        .Where(row => row.IsActive && row.Id != source.Id &&
            (source.PhoneHash is not null && row.PhoneHash is not null && source.PhoneHash.SequenceEqual(row.PhoneHash)
            || source.EmailHash is not null && row.EmailHash is not null && source.EmailHash.SequenceEqual(row.EmailHash)))
        .Select(row => row.Id).Order(StringComparer.Ordinal).ToArray();
    private static string[] PendingMatches(IReadOnlyList<StoredClient> all, IReadOnlyList<ClientReview> reviews, StoredClient source)
    {
        var dismissed = reviews.Where(r => r.PersonId == source.Id && r.Status == "Rejected").SelectMany(r => r.Candidates).ToHashSet();
        return Matches(all, source).Where(id => !dismissed.Contains(id)).ToArray();
    }
    private static bool IsGuestReview(ClientReview review, IdentitySecurity security) => review.Kind == "Edit"
        && JsonSerializer.Deserialize<ReviewProposal>(security.Decrypt(review.Id, "review", review.Proposal))?.Origin == "GuestRequest";
    private static StoredClient Resolve(IReadOnlyList<StoredClient> all, IReadOnlyList<ClientReview> reviews, string id)
    {
        var visited = new HashSet<string>();
        while (visited.Add(id))
        {
            var row = all.SingleOrDefault(p => p.Id == id);
            if (row is { IsActive: true }) return row;
            var association = reviews.FirstOrDefault(r => r.Status == "Accepted" && r.AssociatedPersonId == id && r.PersonId != id);
            if (association?.PersonId is not { } next) break;
            id = next;
        }
        throw Changed();
    }
    private static IdentityProblem Changed() => new(409, "A ficha ou a revisão mudou. Volta a abrir o pedido antes de aprovar.");
}
