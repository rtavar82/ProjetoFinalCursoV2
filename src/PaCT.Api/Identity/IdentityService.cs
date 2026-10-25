using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PaCT.Api.Identity;

public sealed class IdentityService(IIdentityStore store, IdentitySecurity security, IInstallationSecrets installation,
    ISecurityEmailTransport transport, TimeProvider time)
{
    private readonly ConcurrentDictionary<string, (DateTime Start, int Count)> identifierAttempts = new();
    private readonly string dummyPasswordHash = security.HashPassword(Convert.ToHexString(RandomNumberGenerator.GetBytes(24)));
    private DateTime Now => time.GetUtcNow().UtcDateTime;

    public async Task<IdentityAccount> RegisterAsync(ManagerRegistration input, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(input.InstallationCode) || !installation.VerifyInstallationCode(input.InstallationCode))
            throw new IdentityProblem(403, "O código de instalação não é válido.");
        transport.CheckConfiguration();
        if (await store.HasTechnicalManagerAsync(ct)) throw new IdentityProblem(409, "Esta instalação já tem gestor técnico. Usa a opção de entrada.");
        var email = IdentityValidation.Email(input.Email);
        var (person, account) = PrepareRegistration(input.FirstName, input.LastName, input.Locality, input.DisplayName,
            email, input.Password, input.ConfirmPassword, Roles.TechnicalManager);
        await store.CreateAsync(person, account, ConfirmationEmail(account, email), ct);
        return account;
    }

    internal (PrivatePerson Person, IdentityAccount Account) PrepareRegistration(string firstName, string lastName,
        string localityInput, string displayName, string email, string password, string confirmPassword, string role)
    {
        var first = IdentityValidation.Required(firstName, 100, "o primeiro nome");
        var last = IdentityValidation.Required(lastName, 100, "o último nome");
        var locality = IdentityValidation.Required(localityInput, 150, "a localidade");
        var name = IdentityValidation.Required(displayName, 201, "o nome público");
        IdentityValidation.Password(password, confirmPassword);
        var personId = Guid.NewGuid().ToString();
        var person = new PrivatePerson(personId, security.Encrypt(personId, "first-name", first),
            security.Encrypt(personId, "last-name", last), locality, security.Encrypt(personId, "email", email), security.EmailHash(email), Now);
        var account = new IdentityAccount { Id = Guid.NewGuid().ToString(), PersonId = personId, Role = role,
            DisplayName = name, PasswordHash = security.HashPassword(password), SecurityStamp = Guid.NewGuid().ToString(),
            EmailHash = person.EmailHash, EmailCiphertext = person.Email, CreatedAt = person.CreatedAt };
        return (person, account);
    }

    public async Task<PasswordSignInResult> SignInAsync(PasswordSignIn input, string origin, CancellationToken ct)
    {
        var email = IdentityValidation.Email(input.Email);
        var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(origin + ":" + Convert.ToHexString(security.EmailHash(email)))));
        if (identifierAttempts.Count > 10000)
            foreach (var expired in identifierAttempts.Where(item => item.Value.Start.AddMinutes(15) < Now)) identifierAttempts.TryRemove(expired.Key, out _);
        if (identifierAttempts.Count >= 10000 && !identifierAttempts.ContainsKey(key)) return new(null, 429, "Há demasiadas tentativas. Aguarda antes de voltar a tentar.");
        var attempts = identifierAttempts.AddOrUpdate(key, (Now, 1), (_, value) => value.Start.AddMinutes(15) <= Now ? (Now, 1) : (value.Start, value.Count + 1));
        if (attempts.Count > 10) return new(null, 429, "Aguarda 15 minutos antes de voltar a tentar nesta conta.");
        if (input.Password is null || input.Password.Length > 128) return RejectedSignIn();
        var account = await store.FindByEmailAsync(security.EmailHash(email), ct);
        if (account is null || account.PasswordHash is null) { _ = security.VerifyPassword(dummyPasswordHash, input.Password); return RejectedSignIn(); }
        if (!IsAccountAvailable(account)) return RejectedSignIn();
        if (account.LockoutEnd > Now) return new(null, 429, "A conta está temporariamente bloqueada. Aguarda 15 minutos e volta a tentar.");
        if (!security.VerifyPassword(account.PasswordHash, input.Password)) { await FailedAttemptAsync(account, ct); return RejectedSignIn(); }
        return new(account);
    }

    public async Task<IdentityAccount?> PendingAccountAsync(ActionToken? token, CancellationToken ct)
    {
        if (token is null) return null;
        var account = await store.FindAsync(token.AccountId, ct);
        if (account is null || account.SecurityStamp != token.Stamp || !IsAccountAvailable(account)) return null;
        CheckAccount(account);
        return account;
    }

    public async Task<IdentityAccount> ConfirmEmailAsync(string token, CancellationToken ct)
    {
        var action = security.ReadAction("confirm-email", token);
        var account = await PendingAccountAsync(action, ct)
            ?? throw new IdentityProblem(401, "Esta verificação expirou. Inicia sessão novamente.");
        if (action.EmailId is null || !await store.IsConfirmationCurrentAsync(action.EmailId, account.Id, ct))
            throw new IdentityProblem(400, "O link foi substituído ou já não é válido.");
        if (account.Role == Roles.Client && account.PasswordHash is not null) throw new IdentityProblem(400, "A conta já tem palavra-passe. Usa a opção de entrada.");
        var updated = account with { EmailConfirmedAt = account.EmailConfirmedAt ?? Now,
            SecurityStamp = account.Role == Roles.Client ? Guid.NewGuid().ToString() : account.SecurityStamp };
        if (account.EmailConfirmedAt is null || account.Role == Roles.Client) await SaveAsync(updated, ct);
        return updated;
    }

    public async Task<IdentityAccount> SetFirstPasswordAsync(IdentityAccount account, string password, string confirmation, CancellationToken ct)
    {
        if (account.Role != Roles.Client || account.EmailConfirmedAt is null || account.PasswordHash is not null)
            throw new IdentityProblem(403, "Confirma primeiro o email pelo link pessoal. Este passo só define a primeira palavra-passe.");
        IdentityValidation.Password(password, confirmation);
        var updated = account with { PasswordHash = security.HashPassword(password), SecurityStamp = Guid.NewGuid().ToString() };
        await SaveAsync(updated, ct);
        return updated;
    }

    public Task CompleteTrustedSignInAsync(IdentityAccount account, CancellationToken ct) =>
        SaveAsync(account with { FailedSignInCount = 0, LockoutEnd = null, PasswordSignInRequired = false }, ct);

    public async Task ResendEmailAsync(IdentityAccount account, CancellationToken ct)
    {
        transport.CheckConfiguration();
        if (account.EmailConfirmedAt is not null) return;
        var email = security.Decrypt(account.PersonId, "email", account.EmailCiphertext);
        await store.QueueConfirmationAsync(ConfirmationEmail(account, email), ct);
    }

    internal EmailJob ConfirmationEmail(IdentityAccount account, string email)
    {
        var id = Guid.NewGuid().ToString();
        var token = security.ProtectAction("confirm-email", new(account.Id, account.SecurityStamp, id), TimeSpan.FromHours(24));
        return new(id, account.Id, security.Encrypt(id, "email-job", JsonSerializer.Serialize(new EmailPayload(email, token,
            account.Role == Roles.Client ? "ClientConfirmEmail" : "ConfirmEmail"))), "Pending", Now);
    }

    public async Task<object> AuthenticatorAsync(IdentityAccount account, CancellationToken ct)
    {
        if (account.PasskeyEnabledAt is not null) throw new IdentityProblem(409, "Esta conta já utiliza Passkey; o autenticador anterior não pode ser reativado.");
        if (account.EmailConfirmedAt is null || account.PasswordHash is null) throw new IdentityProblem(403, "Confirma primeiro o email e define a palavra-passe.");
        if (account.TwoFactorEnabledAt is not null) throw new IdentityProblem(409, "O autenticador já está configurado. Usa o código para entrar.");
        if (account.AuthenticatorSecret is null)
        {
            var created = security.CreateAuthenticator(account);
            await SaveAsync(account with { AuthenticatorSecret = created.Secret }, ct);
            return new { manualKey = created.ManualKey, uri = created.Uri };
        }
        var key = security.ManualKey(account);
        return new { manualKey = key, uri = "otpauth://totp/" + Uri.EscapeDataString("PaCT:" + account.DisplayName)
            + "?secret=" + key + "&issuer=PaCT&algorithm=SHA1&digits=6&period=30" };
    }

    public async Task<(IdentityAccount Account, string[]? RecoveryCodes)> VerifyFactorAsync(IdentityAccount account, string code, CancellationToken ct)
    {
        if (account.PasskeyEnabledAt is not null) throw new IdentityProblem(403, "Usa a Passkey desta conta. O método anterior não permite entrar.");
        if (account.EmailConfirmedAt is null) throw new IdentityProblem(403, "Confirma primeiro o teu email.");
        if (string.IsNullOrWhiteSpace(code) || code.Length > 128) throw new IdentityProblem(400, "Indica o código do autenticador ou um código de recuperação.");
        var step = security.VerifyTotp(account, code, Now);
        var hashes = JsonSerializer.Deserialize<string[]>(account.RecoveryCodeHashes) ?? [];
        var recoveryHash = IdentitySecurity.RecoveryHash(code);
        var recovery = account.TwoFactorEnabledAt is not null && hashes.Contains(recoveryHash, StringComparer.Ordinal);
        if (step is null && !recovery) { await FailedAttemptAsync(account, ct); throw new IdentityProblem(400, "Código inválido ou já utilizado. Usa o próximo código apresentado pelo Google Authenticator."); }
        string[]? codes = null;
        if (account.TwoFactorEnabledAt is null) { codes = IdentitySecurity.CreateRecoveryCodes(); hashes = codes.Select(IdentitySecurity.RecoveryHash).ToArray(); }
        if (recovery) hashes = hashes.Where(value => value != recoveryHash).ToArray();
        var updated = account with { LastTotpStep = step ?? account.LastTotpStep, TwoFactorEnabledAt = account.TwoFactorEnabledAt ?? Now,
            RecoveryCodeHashes = JsonSerializer.Serialize(hashes), FailedSignInCount = 0, LockoutEnd = null,
            SecurityStamp = recovery ? Guid.NewGuid().ToString() : account.SecurityStamp };
        await SaveAsync(updated, ct);
        return (updated, codes);
    }

    public async Task<bool> VerifyCurrentPasswordAsync(IdentityAccount account, string password, CancellationToken ct)
    {
        CheckAccount(account);
        if (password is null || password.Length > 128 || account.PasswordHash is null || !security.VerifyPassword(account.PasswordHash, password))
        { await FailedAttemptAsync(account, ct); return false; }
        return true;
    }

    public Task RecordFailedPasskeyAsync(IdentityAccount account, CancellationToken ct) => FailedAttemptAsync(account, ct);

    public async Task CloseClientAccountAsync(IdentityAccount account, AccountClosure input, CancellationToken ct)
    {
        if (account.Role != Roles.Client) throw new IdentityProblem(403, "Só o cliente pode encerrar a sua própria conta nesta opção.");
        if (!input.Confirm) throw new IdentityProblem(400, "Confirma que pretendes encerrar a conta e perder o acesso.");
        if (!await VerifyCurrentPasswordAsync(account, input.Password, ct))
            throw new IdentityProblem(400, "Não foi possível confirmar a palavra-passe. A conta não foi encerrada.");
        await SaveAsync(account with { ClosedAt = Now, SecurityStamp = Guid.NewGuid().ToString("D") }, ct);
    }

    private async Task FailedAttemptAsync(IdentityAccount account, CancellationToken ct)
    {
        var failures = account.LockoutEnd is not null && account.LockoutEnd <= Now ? 1 : account.FailedSignInCount + 1;
        await SaveAsync(account with { FailedSignInCount = failures, LockoutEnd = failures >= 5 ? Now.AddMinutes(15) : null }, ct);
    }

    private async Task SaveAsync(IdentityAccount account, CancellationToken ct)
    {
        if (!await store.UpdateAsync(account, Now, ct)) throw new IdentityProblem(409, "O estado da conta mudou. Volta a tentar este passo.");
    }

    private void CheckAccount(IdentityAccount account)
    {
        if (!IsAccountAvailable(account)) throw InvalidCredentials();
        if (account.LockoutEnd > Now) throw new IdentityProblem(429, "A conta está temporariamente bloqueada. Aguarda 15 minutos e volta a tentar.");
    }

    private static bool IsAccountAvailable(IdentityAccount account) => account.ClosedAt is null && account.PersonActive
        && account.LinkStatus == "Verified" && account.Role is Roles.TechnicalManager or Roles.TherapistManager or Roles.Client;

    private static IdentityProblem InvalidCredentials() => new(401, "Não foi possível entrar com os dados indicados.");
    private static PasswordSignInResult RejectedSignIn() => new(null, 401, "Não foi possível entrar com os dados indicados.");
}
