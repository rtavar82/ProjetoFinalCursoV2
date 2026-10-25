using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using Fido2NetLib;
using Fido2NetLib.Objects;

namespace PaCT.Api.Identity;

public sealed class PasskeyService(IPasskeyStore store, IConfiguration configuration, TimeProvider time)
{
    private sealed record Ceremony(string AccountId, string Stamp, string BrowserBinding, DateTimeOffset ExpiresAt,
        Fido2 Verifier, CredentialCreateOptions? Creation, AssertionOptions? Assertion);
    private readonly ConcurrentDictionary<string, Ceremony> ceremonies = new();
    private DateTime Now => time.GetUtcNow().UtcDateTime;

    private Fido2 Verifier()
    {
        var rp = configuration["WebAuthn:RpId"];
        var origins = configuration.GetSection("WebAuthn:Origins").Get<string[]>() ?? [];
        if (string.IsNullOrWhiteSpace(rp) || IPAddress.TryParse(rp, out _) || Uri.CheckHostName(rp) != UriHostNameType.Dns || origins.Length == 0
            || origins.Any(o => !Uri.TryCreate(o, UriKind.Absolute, out var u) || u.Scheme != "https" || u.AbsolutePath != "/"
                || !string.IsNullOrEmpty(u.Query) || !string.IsNullOrEmpty(u.Fragment) || !string.IsNullOrEmpty(u.UserInfo)
                || !(u.Host == rp || u.Host.EndsWith("." + rp, StringComparison.OrdinalIgnoreCase))))
            throw new IdentityProblem(503, "Configura o domínio HTTPS e as origens autorizadas das Passkeys desta instalação.");
        return new Fido2(new Fido2Configuration { RPID = rp, RPName = "PaCT", Origins = origins.ToHashSet(StringComparer.Ordinal), ChallengeSize = 32, Timeout = 300000 });
    }

    private static void Available(IdentityAccount account)
    {
        if (account.EmailConfirmedAt is null || account.PasswordHash is null || account.ClosedAt is not null || !account.PersonActive || account.LinkStatus != "Verified")
            throw new IdentityProblem(403, "Confirma o email e inicia sessão com a tua palavra-passe antes de configurar a Passkey.");
    }

    public async Task<(string Id, CredentialCreateOptions Options)> RegistrationOptions(IdentityAccount account, string binding, CancellationToken ct)
    {
        Available(account); var keys = await store.ListAsync(account.Id, ct);
        if (keys.Count >= 10) throw new IdentityProblem(409, "Esta conta já tem o limite de dez Passkeys.");
        var verifier = Verifier();
        var options = verifier.RequestNewCredential(new RequestNewCredentialParams
        {
            User = new Fido2User { Id = Guid.Parse(account.Id).ToByteArray(), Name = "PaCT-" + account.Id, DisplayName = account.DisplayName },
            ExcludeCredentials = keys.Select(k => new PublicKeyCredentialDescriptor(k.Id)).ToArray(),
            AuthenticatorSelection = new AuthenticatorSelection { ResidentKey = ResidentKeyRequirement.Required, UserVerification = UserVerificationRequirement.Required },
            AttestationPreference = AttestationConveyancePreference.None
        });
        return (Add(account, binding, verifier, options, null), options);
    }

    public async Task<(string Id, AssertionOptions Options)> AssertionOptions(IdentityAccount account, string binding, CancellationToken ct)
    {
        Available(account); var keys = await store.ListAsync(account.Id, ct);
        if (keys.Count == 0) throw new IdentityProblem(409, "Esta conta ainda não tem uma Passkey registada.");
        var verifier = Verifier(); var options = verifier.GetAssertionOptions(new GetAssertionOptionsParams
        { AllowedCredentials = keys.Select(k => new PublicKeyCredentialDescriptor(k.Id)).ToArray(), UserVerification = UserVerificationRequirement.Required });
        return (Add(account, binding, verifier, null, options), options);
    }

    private string Add(IdentityAccount account, string binding, Fido2 verifier, CredentialCreateOptions? creation, AssertionOptions? assertion)
    {
        foreach (var item in ceremonies.Where(x => x.Value.ExpiresAt <= time.GetUtcNow())) ceremonies.TryRemove(item.Key, out _);
        if (ceremonies.Count >= 10000) throw new IdentityProblem(429, "Há demasiadas verificações pendentes. Aguarda antes de tentar novamente.");
        var id = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        ceremonies[id] = new(account.Id, account.SecurityStamp, binding, time.GetUtcNow().AddMinutes(5), verifier, creation, assertion);
        return id;
    }

    private Ceremony Consume(string id, IdentityAccount account, string binding, bool registration)
    {
        Available(account);
        if (id is null || !ceremonies.TryGetValue(id, out var value) || value.AccountId != account.Id || value.Stamp != account.SecurityStamp
            || value.BrowserBinding != binding || value.ExpiresAt <= time.GetUtcNow() || (value.Creation is not null) != registration
            || !ceremonies.TryRemove(new KeyValuePair<string, Ceremony>(id, value)))
            throw new IdentityProblem(400, "A verificação da Passkey expirou ou já foi utilizada. Inicia uma nova tentativa.");
        return value;
    }

    public async Task Register(IdentityAccount account, string binding, PasskeyRegistration input, CancellationToken ct)
    {
        var ceremony = Consume(input.ChallengeId, account, binding, true);
        var name = IdentityValidation.Required(input.Name, 100, "o nome da Passkey");
        try
        {
            var result = await ceremony.Verifier.MakeNewCredentialAsync(new MakeNewCredentialParams
            {
                AttestationResponse = input.Credential, OriginalOptions = ceremony.Creation!,
                IsCredentialIdUniqueToUserCallback = async (args, token) => await store.FindCredentialAsync(args.CredentialId, token) is null
            }, ct);
            if (result.Id.Length is 0 or > 1024 || result.PublicKey.Length > 2048) throw new IdentityProblem(400, "A Passkey ultrapassa os limites admitidos.");
            await store.RegisterAsync(account, new(result.Id, account.Id, result.PublicKey, result.SignCount,
                result.Transports.Select(t => t.ToString()).ToArray(), result.IsBackupEligible, result.IsBackedUp, name, Now), Now, ct);
        }
        catch (Fido2VerificationException) { throw new IdentityProblem(400, "Não foi possível validar a Passkey. Tenta novamente no teu dispositivo."); }
    }

    public async Task Assert(IdentityAccount account, string binding, PasskeyAssertion input, CancellationToken ct)
    {
        var ceremony = Consume(input.ChallengeId, account, binding, false);
        var key = await store.FindCredentialAsync(input.Credential.RawId, ct);
        if (key is null || key.AccountId != account.Id) throw new IdentityProblem(400, "A Passkey não pertence a esta conta.");
        try
        {
            var result = await ceremony.Verifier.MakeAssertionAsync(new MakeAssertionParams
            {
                AssertionResponse = input.Credential, OriginalOptions = ceremony.Assertion!, StoredPublicKey = key.PublicKey, StoredSignatureCounter = key.SignCount,
                IsUserHandleOwnerOfCredentialIdCallback = (args, _) => Task.FromResult(args.UserHandle is not null && args.UserHandle.AsSpan().SequenceEqual(Guid.Parse(account.Id).ToByteArray()) && args.CredentialId.AsSpan().SequenceEqual(key.Id))
            }, ct);
            if (result.IsBackedUp && !key.BackupEligible) throw new IdentityProblem(400, "Os atributos da Passkey não são válidos.");
            await store.UseAsync(account, key, result.SignCount, result.IsBackedUp, Now, ct);
        }
        catch (Fido2VerificationException) { throw new IdentityProblem(400, "A Passkey não foi validada. Inicia uma nova tentativa."); }
    }
}
