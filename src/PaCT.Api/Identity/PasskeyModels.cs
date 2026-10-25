using Fido2NetLib;

namespace PaCT.Api.Identity;

public sealed record AccountPasskey(byte[] Id, string AccountId, byte[] PublicKey, uint SignCount,
    string[] Transports, bool BackupEligible, bool BackedUp, string Name, DateTime CreatedAt, DateTime? LastUsedAt = null);
public sealed record PasskeyRegistration(string ChallengeId, AuthenticatorAttestationRawResponse Credential,
    string Name = "Passkey", bool RememberDevice = false);
public sealed record PasskeyAssertion(string ChallengeId, AuthenticatorAssertionRawResponse Credential, bool RememberDevice = false);
public interface IPasskeyStore
{
    Task<IReadOnlyList<AccountPasskey>> ListAsync(string accountId, CancellationToken ct);
    Task<AccountPasskey?> FindCredentialAsync(byte[] id, CancellationToken ct);
    Task RegisterAsync(IdentityAccount account, AccountPasskey credential, DateTime now, CancellationToken ct);
    Task UseAsync(IdentityAccount account, AccountPasskey credential, uint signCount, bool backedUp, DateTime now, CancellationToken ct);
}
