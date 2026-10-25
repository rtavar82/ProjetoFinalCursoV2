using System.Text.Json;

namespace PaCT.Api.Identity;

public sealed class ClientAccessService(IClientAccessStore store, IIdentityStore identities, IdentityService identity,
    IdentitySecurity security, ISecurityEmailTransport transport, TimeProvider time)
{
    private DateTime Now => time.GetUtcNow().UtcDateTime;
    private static IdentityProblem Changed() => new(409, "A conta mudou entretanto. Atualiza a segurança da conta antes de continuar.");
    private static IdentityProblem InvalidLink() => new(400, "Este link já não é válido. Pede à gestão um novo envio.");
    private static bool Available(IdentityAccount? account) => account is { Role: Roles.Client, ClosedAt: null,
        PersonActive: true, LinkStatus: "Verified", EmailConfirmedAt: not null, PasswordHash: not null };

    private async Task<IdentityAccount> ManagerAsync(string id, string? password, CancellationToken ct)
    {
        var manager = await identities.FindAsync(id, ct);
        if (manager is null || manager.Role is not (Roles.TechnicalManager or Roles.TherapistManager)
            || manager.ClosedAt is not null || !manager.PersonActive || manager.EmailConfirmedAt is null || manager.PasswordHash is null)
            throw new IdentityProblem(403, "Não tens autorização para gerir o acesso desta conta.");
        if (password is not null)
        {
            if (manager.LockoutEnd > Now) throw new IdentityProblem(429, "A conta está temporariamente bloqueada.");
            if (password.Length is 0 or > 128 || !security.VerifyPassword(manager.PasswordHash, password))
            {
                await identity.RecordFailedPasskeyAsync(manager, ct);
                throw new IdentityProblem(400, "Não foi possível confirmar a tua palavra-passe. Nenhuma alteração foi feita.");
            }
        }
        return manager;
    }

    private static async Task<IdentityAccount> ClientAsync(IClientAccessSession session, string personId)
    {
        var account = await session.AccountAsync(personId, true);
        if (!Available(account)) throw new IdentityProblem(409, "Esta ficha não tem uma conta de cliente ativa com o registo concluído.");
        return account!;
    }

    private ClientAccessDetails Details(ClientAccessAction action) => JsonSerializer.Deserialize<ClientAccessDetails>(
        security.Decrypt(action.Id, "client-access-action", action.Details)) ?? throw InvalidLink();

    public async Task<object> StatusAsync(string personId, string author, CancellationToken ct)
    {
        await ManagerAsync(author, null, ct);
        return await store.ExecuteAsync<object>(async session =>
        {
            var account = await ClientAsync(session, personId);
            var actions = await session.ActionsAsync(account.Id);
            var pending = actions.FirstOrDefault(a => Current(a, account, Now));
            return new { accountId = account.Id, version = account.Version,
                passkeyEnabled = account.PasskeyEnabledAt is not null, passkeyCount = await session.PasskeyCountAsync(account.Id),
                pendingEmailChange = pending is null ? null : new { pending.Id, email = Details(pending).NewEmail, pending.ExpiresAt },
                history = actions.Take(10).Select(a => new { a.Id, a.Kind, status = a.Status == "Pending" && !Current(a, account, Now) ? "Expired" : a.Status,
                    a.CreatedByAccountId, a.CreatedAt, a.CompletedAt }) };
        }, ct);
    }

    public async Task<object> RequestAsync(string personId, string author, ClientAccessRequest input, bool resetPasskeys, CancellationToken ct)
    {
        if (input.OperationId == Guid.Empty || !input.ConfirmIdentity || input.Password is null)
            throw new IdentityProblem(400, "Confirma a identidade do cliente e indica a tua palavra-passe.");
        var manager = await ManagerAsync(author, input.Password, ct);
        var email = resetPasskeys ? null : IdentityValidation.Email(input.NewEmail ?? "");
        return await store.ExecuteAsync<object>(async session =>
        {
            var actor = await session.AccountAsync(author);
            if (actor?.SecurityStamp != manager.SecurityStamp || actor.Role != manager.Role || actor.ClosedAt is not null) throw Changed();
            var account = await ClientAsync(session, personId);
            var kind = resetPasskeys ? "ResetPasskeys" : "ChangeEmail";
            var operationId = input.OperationId.ToString("D");
            if (await session.ActionAsync(operationId) is { } prior)
            {
                if (prior.AccountId != account.Id || prior.PersonId != personId || prior.CreatedByAccountId != author || prior.Kind != kind
                    || !string.Equals(Details(prior).NewEmail, email, StringComparison.OrdinalIgnoreCase)) throw Changed();
                return Result(prior);
            }
            if (account.Version != input.Version) throw Changed();
            var now = Now;
            var oldEmail = security.Decrypt(account.PersonId, "email", account.EmailCiphertext);
            byte[]? hash = email is null ? null : security.EmailHash(email);
            if (hash is not null)
            {
                if (hash.SequenceEqual(account.EmailHash)) throw new IdentityProblem(400, "Este já é o email de acesso da conta.");
                if (await session.EmailUsedAsync(hash, personId)) throw new IdentityProblem(409, "Este email já está associado a outra ficha ou conta. Verifica os dados antes de continuar.");
                transport.CheckConfiguration();
            }
            var actions = await session.ActionsAsync(account.Id);
            if (!resetPasskeys) AccountEmailLimits.Check(actions, "ChangeEmail", author, now);
            var count = resetPasskeys ? await session.PasskeyCountAsync(account.Id) : 0;
            var action = new ClientAccessAction(operationId, account.Id, personId, author, kind, resetPasskeys ? "Applied" : "Pending",
                Guid.NewGuid().ToString("D"), account.EmailHash, hash,
                security.Encrypt(operationId, "client-access-action", JsonSerializer.Serialize(new ClientAccessDetails(email, oldEmail, count))),
                now, resetPasskeys ? now : now.AddHours(24), resetPasskeys ? now : null);
            if (resetPasskeys) await session.ResetPasskeysAsync(account, now);
            else
            {
                foreach (var previous in actions.Where(a => a.Kind == "ChangeEmail" && a.Status == "Pending"))
                    await session.SaveActionAsync(previous with { Status = "Superseded", CompletedAt = now }, false);
            }
            await session.SaveActionAsync(action, true);
            if (!resetPasskeys)
            {
                var token = security.ProtectAction("client-access-email", new(account.Id, action.SecurityStamp, action.Id), TimeSpan.FromHours(24));
                await session.QueueEmailAsync(new(action.Id, account.Id,
                    security.Encrypt(action.Id, "email-job", JsonSerializer.Serialize(new EmailPayload(email!, token, "ClientAccessEmail"))), "Pending", now));
            }
            return Result(action);
        }, ct);
    }

    private static object Result(ClientAccessAction action) => new { action.Id, action.Status,
        message = action.Kind == "ResetPasskeys"
            ? "As Passkeys foram removidas e as sessões anteriores terminaram. O cliente pode entrar com a mesma palavra-passe e registar uma nova Passkey."
            : action.Status == "Confirmed" ? "O novo email já foi confirmado."
            : action.Status == "Pending" ? "O pedido de confirmação ficou em fila para o novo email. O email atual mantém-se até o cliente confirmar."
            : "Este pedido foi substituído. Atualiza a segurança da conta antes de continuar." };

    private static bool Current(ClientAccessAction action, IdentityAccount account, DateTime now) => action.Kind == "ChangeEmail"
        && action.Status == "Pending" && action.ExpiresAt > now && action.AccountId == account.Id && action.PersonId == account.PersonId
        && action.PreviousEmailHash.SequenceEqual(account.EmailHash) && Available(account);

    public async Task<bool> CanSendEmailAsync(EmailJob job, EmailPayload payload, CancellationToken ct)
    {
        if (!security.TryReadAction("client-access-email", payload.Token, out var token, out _) || token.EmailId != job.Id || token.AccountId != job.AccountId) return false;
        return await store.ExecuteAsync(async session =>
        {
            var action = await session.ActionAsync(job.Id);
            var account = await session.AccountAsync(job.AccountId);
            return action is not null && account is not null && token.Stamp == action.SecurityStamp && Current(action, account, Now)
                && string.Equals(Details(action).NewEmail, payload.Recipient, StringComparison.OrdinalIgnoreCase);
        }, ct);
    }

    public async Task ConfirmEmailAsync(string value, CancellationToken ct)
    {
        var token = security.ReadAction("client-access-email", value);
        if (token.EmailId is null) throw InvalidLink();
        await store.ExecuteAsync(async session =>
        {
            var action = await session.ActionAsync(token.EmailId);
            var account = await session.AccountAsync(token.AccountId);
            var now = Now;
            if (action is null || account is null || action.SecurityStamp != token.Stamp || !Current(action, account, now)) throw InvalidLink();
            var email = Details(action).NewEmail;
            if (email is null || action.EmailHash is null || !security.EmailHash(email).SequenceEqual(action.EmailHash)) throw InvalidLink();
            if (await session.EmailUsedAsync(action.EmailHash, account.PersonId))
                throw new IdentityProblem(409, "Não foi possível confirmar este email. Contacta a gestão para verificar o pedido.");
            await session.ChangeEmailAsync(account, security.Encrypt(account.PersonId, "email", email), action.EmailHash, now);
            await session.SaveActionAsync(action with { Status = "Confirmed", CompletedAt = now }, false);
            return true;
        }, ct);
    }
}
