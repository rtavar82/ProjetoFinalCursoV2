namespace PaCT.Api.Identity;

public sealed record PasswordChangeRequest(Guid OperationId, string Password);
public sealed record PasswordChangeConfirmation(string Token, string Password, string ConfirmPassword);
public sealed record GoogleStartRequest(string Mode, string? Password = null);
public sealed record GoogleAccountLink(string Id, string AccountId, byte[] SubjectHash, byte[] IdentityCiphertext, DateTime CreatedAt);
public sealed record GoogleIdentity(string Subject, string Email);
