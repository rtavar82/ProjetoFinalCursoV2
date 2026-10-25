using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using OtpNet;
using System.Diagnostics.CodeAnalysis;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PaCT.Api.Identity;

public sealed class IdentitySecurity(IDataProtectionProvider provider, IInstallationSecrets secrets, TimeProvider time)
{
    public const int PasswordIterations = 220000;
    private readonly PasswordHasher<string> hasher = new(Options.Create(new PasswordHasherOptions { IterationCount = PasswordIterations }));
    public string HashPassword(string password) => hasher.HashPassword("PaCT", password);
    public bool VerifyPassword(string hash, string password) => hasher.VerifyHashedPassword("PaCT", hash, password) != PasswordVerificationResult.Failed;
    public byte[] Encrypt(string owner, string field, string value) =>
        provider.CreateProtector("PaCT0.2.Private.v1", owner, field).Protect(Encoding.UTF8.GetBytes(value));
    public string Decrypt(string owner, string field, byte[] value) =>
        Encoding.UTF8.GetString(provider.CreateProtector("PaCT0.2.Private.v1", owner, field).Unprotect(value));
    public byte[] EmailHash(string email) => HMACSHA256.HashData(secrets.SearchKey, Encoding.UTF8.GetBytes("email:" + email.Trim().ToUpperInvariant()));
    public byte[] GoogleSubjectHash(string subject) => HMACSHA256.HashData(secrets.SearchKey, Encoding.UTF8.GetBytes("external:Google:" + subject));
    public byte[] PhoneHash(string dialCode, string number) => HMACSHA256.HashData(secrets.SearchKey, Encoding.UTF8.GetBytes("phone:" + dialCode + ":" + number));
    public string ProtectAction(string purpose, ActionToken value, TimeSpan lifetime) =>
        provider.CreateProtector("PaCT0.2.Action.v1", purpose).ToTimeLimitedDataProtector().Protect(JsonSerializer.Serialize(value), time.GetUtcNow().Add(lifetime));
    public ActionToken ReadAction(string purpose, string value) =>
        TryReadAction(purpose, value, out var action, out _) ? action : throw InvalidAction();

    public bool TryReadAction(string purpose, string? value, [NotNullWhen(true)] out ActionToken? action, out DateTimeOffset expiresAt)
    {
        action = null;
        expiresAt = default;
        if (!TryUnprotect<ActionToken>(purpose, value, out var candidate, out var expiration)
            || string.IsNullOrEmpty(candidate.AccountId) || string.IsNullOrEmpty(candidate.Stamp)) return false;
        action = candidate;
        expiresAt = expiration;
        return true;
    }

    public string ProtectInvitation(TherapistInvitation invitation) => provider.CreateProtector("PaCT0.2.Action.v1", "therapist-invitation")
        .ToTimeLimitedDataProtector().Protect(JsonSerializer.Serialize(new InvitationToken(invitation.Id, invitation.SecurityStamp)),
            new DateTimeOffset(DateTime.SpecifyKind(invitation.ExpiresAt, DateTimeKind.Utc)));

    public bool TryReadInvitation(string? value, [NotNullWhen(true)] out InvitationToken? invitation)
    {
        invitation = null;
        if (!TryUnprotect<InvitationToken>("therapist-invitation", value, out var candidate, out var expiration)
            || expiration <= time.GetUtcNow() || !Guid.TryParse(candidate.InvitationId, out _) || string.IsNullOrEmpty(candidate.Stamp)) return false;
        invitation = candidate;
        return true;
    }

    private bool TryUnprotect<T>(string purpose, string? value, [NotNullWhen(true)] out T? result, out DateTimeOffset expiresAt) where T : class
    {
        result = null;
        expiresAt = default;
        if (string.IsNullOrEmpty(value) || value.Length > 12000) return false;
        try
        {
            var candidate = JsonSerializer.Deserialize<T>(provider.CreateProtector("PaCT0.2.Action.v1", purpose)
                .ToTimeLimitedDataProtector().Unprotect(value, out var expiration));
            if (candidate is null) return false;
            result = candidate;
            expiresAt = expiration;
            return true;
        }
        catch (Exception error) when (error is CryptographicException or JsonException or FormatException) { return false; }
    }

    public (byte[] Secret, string ManualKey, string Uri) CreateAuthenticator(IdentityAccount account)
    {
        var secret = RandomNumberGenerator.GetBytes(20);
        var key = Base32Encoding.ToString(secret);
        var uri = "otpauth://totp/" + System.Uri.EscapeDataString("PaCT:" + account.DisplayName)
            + "?secret=" + key + "&issuer=PaCT&algorithm=SHA1&digits=6&period=30";
        return (Encrypt(account.Id, "authenticator", key), key, uri);
    }

    public string ManualKey(IdentityAccount account) => Decrypt(account.Id, "authenticator", account.AuthenticatorSecret!);
    public long? VerifyTotp(IdentityAccount account, string code, DateTime now)
    {
        code = code.Replace(" ", "", StringComparison.Ordinal);
        if (account.AuthenticatorSecret is null || code.Length != 6 || !code.All(char.IsAsciiDigit)) return null;
        var totp = new Totp(Base32Encoding.ToBytes(ManualKey(account)));
        return totp.VerifyTotp(now, code, out var step, VerificationWindow.RfcSpecifiedNetworkDelay)
            && (account.LastTotpStep is null || step > account.LastTotpStep) ? step : null;
    }

    public static string RecoveryHash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value.Replace("-", "", StringComparison.Ordinal).Replace(" ", "", StringComparison.Ordinal).ToUpperInvariant())));
    public static string[] CreateRecoveryCodes() => Enumerable.Range(0, 8).Select(_ => Convert.ToHexString(RandomNumberGenerator.GetBytes(16))).ToArray();
    private static IdentityProblem InvalidAction() => new(400, "O pedido é inválido ou expirou. Inicia novamente este passo.");
}
