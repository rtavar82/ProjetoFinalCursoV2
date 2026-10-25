namespace PaCT.Api.Identity;

public sealed record ClientAccessRequest(Guid OperationId, ulong Version, string Password, bool ConfirmIdentity, string? NewEmail = null);
public sealed record ClientAccessAction(string Id, string AccountId, string PersonId, string CreatedByAccountId,
    string Kind, string Status, string SecurityStamp, byte[] PreviousEmailHash, byte[]? EmailHash,
    byte[] Details, DateTime CreatedAt, DateTime ExpiresAt, DateTime? CompletedAt = null);
public sealed record ClientAccessDetails(string? NewEmail, string PreviousEmail, int PasskeysRemoved = 0);

public interface IClientAccessStore
{
    Task<T> ExecuteAsync<T>(Func<IClientAccessSession, Task<T>> action, CancellationToken ct);
}

public interface IClientAccessSession
{
    Task<IdentityAccount?> AccountAsync(string id, bool byPerson = false);
    Task<ClientAccessAction?> ActionAsync(string id);
    Task<IReadOnlyList<ClientAccessAction>> ActionsAsync(string accountId);
    Task<int> PasskeyCountAsync(string accountId);
    Task<bool> EmailUsedAsync(byte[] hash, string personId);
    Task SaveActionAsync(ClientAccessAction action, bool create);
    Task QueueEmailAsync(EmailJob job);
    Task ChangeEmailAsync(IdentityAccount account, byte[] ciphertext, byte[] hash, DateTime now);
    Task ResetPasskeysAsync(IdentityAccount account, DateTime now);
    Task ChangePasswordAsync(IdentityAccount account, string hash, DateTime now);
    Task<GoogleAccountLink?> GoogleLinkAsync(string accountId);
    Task<GoogleAccountLink?> GoogleSubjectAsync(byte[] subjectHash);
    Task AddGoogleLinkAsync(GoogleAccountLink link);
    Task RemoveGoogleLinkAsync(IdentityAccount account, DateTime now);
}
