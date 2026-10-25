using System.Text.Json;

namespace PaCT.Api.Identity;

public sealed class PasswordChangeService(IClientAccessStore store, IIdentityStore identities, IdentityService identity,
    IdentitySecurity security, ISecurityEmailTransport transport, TimeProvider time)
{
    private DateTime Now => time.GetUtcNow().UtcDateTime;
    internal static bool Active(IdentityAccount? account) => account is { ClosedAt: null, PersonActive: true, LinkStatus: "Verified", EmailConfirmedAt: not null, PasswordHash: not null };
    private static IdentityProblem Invalid() => new(400, "Este link já não é válido. Pede um novo email para alterar a palavra-passe.");

    internal async Task<IdentityAccount> VerifyOwnPassword(string id, string? password, CancellationToken ct)
    {
        var account = await identities.FindAsync(id, ct);
        if (!Active(account)) throw new IdentityProblem(401, "Inicia sessão novamente.");
        if (account!.LockoutEnd > Now) throw new IdentityProblem(429, "A conta está temporariamente bloqueada.");
        if (password is null || password.Length is 0 or > 128 || !security.VerifyPassword(account.PasswordHash!, password))
        {
            await identity.RecordFailedPasskeyAsync(account, ct);
            throw new IdentityProblem(400, "Não foi possível confirmar a tua palavra-passe.");
        }
        return account;
    }

    public async Task RequestAsync(string id, PasswordChangeRequest input, CancellationToken ct)
    {
        if (input.OperationId == Guid.Empty) throw new IdentityProblem(400, "Inicia novamente o pedido de alteração.");
        var proof = await VerifyOwnPassword(id, input.Password, ct);
        await store.ExecuteAsync(async session =>
        {
            var account = await session.AccountAsync(id);
            if (!Active(account) || account!.SecurityStamp != proof.SecurityStamp) throw new IdentityProblem(409, "A conta mudou entretanto. Inicia sessão novamente.");
            var actionId = input.OperationId.ToString("D");
            if (await session.ActionAsync(actionId) is { } old)
            {
                if (old.Kind != "ChangePassword" || old.AccountId != id || old.CreatedByAccountId != id) throw new IdentityProblem(409, "O pedido já foi utilizado.");
                return true;
            }
            transport.CheckConfiguration();
            var now = Now;
            var actions = await session.ActionsAsync(id);
            AccountEmailLimits.Check(actions, "ChangePassword", id, now);
            foreach (var previous in actions.Where(a => a.Kind == "ChangePassword" && a.Status == "Pending"))
                await session.SaveActionAsync(previous with { Status = "Superseded", CompletedAt = now }, false);
            var email = security.Decrypt(account.PersonId, "email", account.EmailCiphertext);
            var action = new ClientAccessAction(actionId, id, account.PersonId, id, "ChangePassword", "Pending", account.SecurityStamp,
                account.EmailHash, null, security.Encrypt(actionId, "password-change-action", JsonSerializer.Serialize(new { Email = email })), now, now.AddHours(24));
            await session.SaveActionAsync(action, true);
            var token = security.ProtectAction("change-password", new(id, account.SecurityStamp, actionId), TimeSpan.FromHours(24));
            await session.QueueEmailAsync(new(actionId, id, security.Encrypt(actionId, "email-job", JsonSerializer.Serialize(new EmailPayload(email, token, "PasswordChange"))), "Pending", now));
            return true;
        }, ct);
    }

    private bool Current(ClientAccessAction? action, IdentityAccount? account, ActionToken token) => action is { Kind: "ChangePassword", Status: "Pending" }
        && Active(account) && action.AccountId == token.AccountId && action.PersonId == account!.PersonId && action.ExpiresAt > Now
        && action.SecurityStamp == token.Stamp && account.SecurityStamp == token.Stamp && action.PreviousEmailHash.SequenceEqual(account.EmailHash);

    public async Task<bool> CanSendAsync(EmailJob job, EmailPayload payload, CancellationToken ct)
    {
        if (!security.TryReadAction("change-password", payload.Token, out var token, out _) || token.EmailId != job.Id || token.AccountId != job.AccountId) return false;
        return await store.ExecuteAsync(async session =>
        {
            var action = await session.ActionAsync(job.Id); var account = await session.AccountAsync(job.AccountId);
            return Current(action, account, token) && security.EmailHash(payload.Recipient).SequenceEqual(account!.EmailHash);
        }, ct);
    }

    public async Task ConfirmAsync(PasswordChangeConfirmation input, string? signedInAccount, CancellationToken ct)
    {
        var token = security.ReadAction("change-password", input.Token);
        if (signedInAccount is not null && signedInAccount != token.AccountId) throw new IdentityProblem(409, "Abre este link numa janela privada ou termina a sessão atual.");
        if (token.EmailId is null) throw Invalid();
        IdentityValidation.Password(input.Password, input.ConfirmPassword);
        await store.ExecuteAsync(async session =>
        {
            var action = await session.ActionAsync(token.EmailId); var account = await session.AccountAsync(token.AccountId);
            if (!Current(action, account, token)) throw Invalid();
            if (security.VerifyPassword(account!.PasswordHash!, input.Password)) throw new IdentityProblem(400, "Escolhe uma palavra-passe diferente da atual.");
            var hash = security.HashPassword(input.Password);
            var now = Now;
            await session.ChangePasswordAsync(account, hash, now);
            await session.SaveActionAsync(action! with { Status = "Confirmed", CompletedAt = now }, false);
            return true;
        }, ct);
    }
}
