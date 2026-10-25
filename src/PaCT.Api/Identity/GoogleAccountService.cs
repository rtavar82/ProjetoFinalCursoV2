using System.Text.Json;

namespace PaCT.Api.Identity;

public sealed class GoogleAccountService(IClientAccessStore store, IdentitySecurity security, TimeProvider time)
{
    public async Task<object> StatusAsync(string accountId, bool enabled, CancellationToken ct) => await store.ExecuteAsync<object>(async session =>
    {
        var account = await session.AccountAsync(accountId);
        if (!PasswordChangeService.Active(account)) throw new IdentityProblem(401, "Inicia sessão novamente.");
        var link = await session.GoogleLinkAsync(accountId);
        var identity = link is null ? null : JsonSerializer.Deserialize<GoogleIdentity>(security.Decrypt(link.Id, "google-identity", link.IdentityCiphertext));
        return new { enabled, linked = link is not null, email = identity?.Email };
    }, ct);

    public async Task LinkAsync(string accountId, string stamp, GoogleIdentity identity, CancellationToken ct)
    {
        Validate(identity);
        await store.ExecuteAsync(async session =>
        {
            var account = await session.AccountAsync(accountId);
            if (!PasswordChangeService.Active(account) || account!.SecurityStamp != stamp) throw new IdentityProblem(401, "Inicia sessão novamente para associar o Google.");
            var hash = security.GoogleSubjectHash(identity.Subject);
            var owner = await session.GoogleSubjectAsync(hash);
            var previous = await session.GoogleLinkAsync(accountId);
            if (owner is not null && owner.AccountId != accountId || previous is not null && !previous.SubjectHash.SequenceEqual(hash))
                throw new IdentityProblem(409, "Esta ligação ao Google já está associada. Não foi alterada nenhuma conta.");
            if (owner is not null) return true;
            var id = Guid.NewGuid().ToString("D"); var now = time.GetUtcNow().UtcDateTime;
            await session.AddGoogleLinkAsync(new(id, accountId, hash, security.Encrypt(id, "google-identity", JsonSerializer.Serialize(identity)), now));
            await Audit(session, account, "LinkGoogle", now);
            return true;
        }, ct);
    }

    public async Task<IdentityAccount?> ResolveAsync(GoogleIdentity identity, CancellationToken ct)
    {
        Validate(identity);
        return await store.ExecuteAsync(async session =>
        {
            var link = await session.GoogleSubjectAsync(security.GoogleSubjectHash(identity.Subject));
            var account = link is null ? null : await session.AccountAsync(link.AccountId);
            if (!PasswordChangeService.Active(account)) return null;
            if (account!.PasswordSignInRequired) throw new IdentityProblem(403, "Entra com o teu email e a nova palavra-passe antes de voltares a usar o Google.");
            if (account.LockoutEnd > time.GetUtcNow().UtcDateTime) throw new IdentityProblem(429, "A conta está temporariamente bloqueada.");
            return account;
        }, ct);
    }

    public async Task UnlinkAsync(string accountId, string stamp, CancellationToken ct)
    {
        await store.ExecuteAsync(async session =>
        {
            var account = await session.AccountAsync(accountId);
            if (!PasswordChangeService.Active(account) || account!.SecurityStamp != stamp) throw new IdentityProblem(401, "Inicia sessão novamente.");
            var now = time.GetUtcNow().UtcDateTime;
            await session.RemoveGoogleLinkAsync(account, now);
            await Audit(session, account, "UnlinkGoogle", now);
            return true;
        }, ct);
    }

    private Task Audit(IClientAccessSession session, IdentityAccount account, string kind, DateTime now)
    {
        var id = Guid.NewGuid().ToString("D");
        return session.SaveActionAsync(new(id, account.Id, account.PersonId, account.Id, kind, "Applied", account.SecurityStamp,
            account.EmailHash, null, security.Encrypt(id, "external-account-action", "Google"), now, now, now), true);
    }
    private static void Validate(GoogleIdentity identity)
    {
        if (string.IsNullOrWhiteSpace(identity.Subject) || identity.Subject.Length > 255 || identity.Subject.Any(char.IsWhiteSpace))
            throw new IdentityProblem(400, "Não foi possível confirmar a conta Google.");
        _ = IdentityValidation.Email(identity.Email);
    }
}
