using System.Text.Json;
using System.Threading.Channels;

namespace PaCT.Api.Identity;

public sealed class PasswordChangeService(IClientAccessStore store, IIdentityStore identities, IdentityService identity,
    IdentitySecurity security, ISecurityEmailTransport transport, TimeProvider time)
{
    internal const string ChangeKind = "ChangePassword";
    internal const string RecoveryKind = "RecoverPassword";
    private static readonly TimeSpan RecoveryLifetime = TimeSpan.FromMinutes(30);
    private readonly Channel<byte[]> recoveryRequests = Channel.CreateBounded<byte[]>(128);
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
            await QueueChangeAsync(session, account, actionId, ChangeKind, now);
            return true;
        }, ct);
    }

    public void RequestRecovery(PasswordRecoveryRequest input)
    {
        var emailHash = security.EmailHash(IdentityValidation.Email(input.Email));
        if (!recoveryRequests.Writer.TryWrite(emailHash))
            throw new IdentityProblem(503, "Não foi possível receber o pedido agora. Tenta novamente dentro de instantes.");
    }

    internal IAsyncEnumerable<byte[]> RecoveryRequests(CancellationToken ct) => recoveryRequests.Reader.ReadAllAsync(ct);

    internal async Task QueueRecoveryEmailAsync(byte[] emailHash, CancellationToken ct)
    {
        var match = await identities.FindByEmailAsync(emailHash, ct);
        if (!Active(match)) return;
        await store.ExecuteAsync(async session =>
        {
            var account = await session.AccountAsync(match!.Id);
            if (!Active(account) || !account!.EmailHash.SequenceEqual(emailHash)) return false;
            var now = Now;
            var actions = await session.ActionsAsync(account.Id);
            var recoveryActions = actions.Where(a => a.Kind == RecoveryKind).ToArray();
            if (recoveryActions.Any(a => a.CreatedAt.AddMinutes(5) > now
                || a.Status == "Pending" && a.SecurityStamp == account.SecurityStamp && a.ExpiresAt > now))
                return false;
            foreach (var previous in recoveryActions.Where(a => a.Status == "Pending"))
                await session.SaveActionAsync(previous with { Status = "Superseded", CompletedAt = now }, false);
            await QueueChangeAsync(session, account, Guid.NewGuid().ToString("D"), RecoveryKind, now);
            return true;
        }, ct);
    }

    private async Task QueueChangeAsync(IClientAccessSession session, IdentityAccount account, string id, string kind, DateTime now)
    {
        var lifetime = kind == RecoveryKind ? RecoveryLifetime : TimeSpan.FromHours(24);
        var email = security.Decrypt(account.PersonId, "email", account.EmailCiphertext);
        var action = new ClientAccessAction(id, account.Id, account.PersonId, kind == RecoveryKind ? null : account.Id, kind, "Pending",
            account.SecurityStamp, account.EmailHash, null, security.Encrypt(id, "password-change-action", JsonSerializer.Serialize(new { Email = email })),
            now, now.Add(lifetime));
        await session.SaveActionAsync(action, true);
        var token = security.ProtectAction(Purpose(kind), new(account.Id, account.SecurityStamp, id), lifetime);
        await session.QueueEmailAsync(new(id, account.Id, security.Encrypt(id, "email-job",
            JsonSerializer.Serialize(new EmailPayload(email, token, kind == RecoveryKind ? "PasswordRecovery" : "PasswordChange"))), "Pending", now));
    }

    private static string Purpose(string kind) => kind == RecoveryKind ? "recover-password" : "change-password";

    private bool Current(ClientAccessAction? action, IdentityAccount? account, ActionToken token, string kind) =>
        action is { Status: "Pending" } && action.Kind == kind
        && Active(account) && action.AccountId == token.AccountId && action.PersonId == account!.PersonId && action.ExpiresAt > Now
        && action.SecurityStamp == token.Stamp && account.SecurityStamp == token.Stamp && action.PreviousEmailHash.SequenceEqual(account.EmailHash);

    public async Task<bool> CanSendAsync(EmailJob job, EmailPayload payload, CancellationToken ct)
    {
        var kind = payload.Kind == "PasswordRecovery" ? RecoveryKind : ChangeKind;
        if (!security.TryReadAction(Purpose(kind), payload.Token, out var token, out _) || token.EmailId != job.Id || token.AccountId != job.AccountId) return false;
        return await store.ExecuteAsync(async session =>
        {
            var action = await session.ActionAsync(job.Id); var account = await session.AccountAsync(job.AccountId);
            return Current(action, account, token, kind) && security.EmailHash(payload.Recipient).SequenceEqual(account!.EmailHash);
        }, ct);
    }

    public async Task ConfirmAsync(PasswordChangeConfirmation input, string? signedInAccount, CancellationToken ct, string kind = ChangeKind)
    {
        if (!security.TryReadAction(Purpose(kind), input.Token, out var token, out _) || token.EmailId is null) throw Invalid();
        if (signedInAccount is not null && signedInAccount != token.AccountId) throw new IdentityProblem(409, "Abre este link numa janela privada ou termina a sessão atual.");
        IdentityValidation.Password(input.Password, input.ConfirmPassword);
        await store.ExecuteAsync(async session =>
        {
            var action = await session.ActionAsync(token.EmailId); var account = await session.AccountAsync(token.AccountId);
            if (!Current(action, account, token, kind)) throw Invalid();
            if (security.VerifyPassword(account!.PasswordHash!, input.Password)) throw new IdentityProblem(400, "Escolhe uma palavra-passe diferente da atual.");
            var hash = security.HashPassword(input.Password);
            var now = Now;
            await session.ChangePasswordAsync(account, hash, now);
            await session.SaveActionAsync(action! with { Status = "Confirmed", CompletedAt = now }, false);
            return true;
        }, ct);
    }
}

internal sealed class PasswordRecoveryWorker(PasswordChangeService passwords, ILogger<PasswordRecoveryWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var emailHash in passwords.RecoveryRequests(stoppingToken))
        {
            for (var attempt = 1; attempt <= 3; attempt++)
            {
                try
                {
                    await passwords.QueueRecoveryEmailAsync(emailHash, stoppingToken);
                    break;
                }
                catch (Exception error) when (!stoppingToken.IsCancellationRequested)
                {
                    logger.LogWarning("Password recovery preparation failed: type={ErrorType}, attempt={Attempt}", error.GetType().Name, attempt);
                    if (attempt < 3) await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
                }
            }
        }
    }
}
