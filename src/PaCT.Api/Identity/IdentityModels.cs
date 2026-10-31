namespace PaCT.Api.Identity;

public static class Roles
{
    public const string TechnicalManager = "TechnicalManager";
    public const string TherapistManager = "TherapistManager";
    public const string Client = "Client";
    public const string Managers = TechnicalManager + "," + TherapistManager;
    public const string ManagersAndClient = Managers + "," + Client;
    public static bool IsManager(string? role) => role is TechnicalManager or TherapistManager;
}

public sealed record ManagerRegistration(string InstallationCode, string FirstName, string LastName,
    string Locality, string DisplayName, string Email, string Password, string ConfirmPassword);
public sealed record PasswordSignIn(string Email, string Password);
public sealed record AccountClosure(string Password, bool Confirm);
public sealed record PasswordSignInResult(IdentityAccount? Account, int Status = 200, string? Message = null);
public sealed record FactorVerification(string Code, bool RememberDevice = false);
public sealed record EmailConfirmation(string Token);
public sealed record ActionToken(string AccountId, string Stamp, string? EmailId = null, string Method = "Password");
public sealed record AppointmentEmailSummary(string Service, DateTimeOffset StartsAt, DateTimeOffset EndsAt,
    string PublicLocation, string PaymentMode, decimal? Price, string Instructions = "");
public sealed record EmailPayload(string Recipient, string Token, string Kind = "ConfirmEmail", string? InvitationId = null,
    AppointmentEmailSummary? Appointment = null);
public sealed record EmailJob(string Id, string AccountId, byte[] Payload, string State, DateTime CreatedAt);
public sealed record PrivatePerson(string Id, byte[]? FirstName, byte[]? LastName, string? Locality,
    byte[] Email, byte[] EmailHash, DateTime CreatedAt);

public sealed record TherapistInvitationRequest(string Email, string? ReplaceInvitationId = null);
public sealed record InvitationToken(string InvitationId, string Stamp);
public sealed record InvitationPreviewRequest(string Token);
public sealed record TherapistRegistration(string Token, string FirstName, string LastName,
    string Locality, string DisplayName, string Password, string ConfirmPassword);
public sealed record TherapistInvitation(string Id, string CreatedByAccountId, byte[] EmailCiphertext, byte[] EmailHash,
    string SecurityStamp, string EmailJobId, DateTime CreatedAt, DateTime ExpiresAt,
    DateTime? CancelledAt = null, DateTime? AcceptedAt = null, string? AcceptedByAccountId = null)
{
    public bool IsOpen(DateTime now) => CancelledAt is null && AcceptedAt is null && ExpiresAt > now;
}

public interface ITherapistInvitationStore
{
    Task<IdentityAccount?> FindTherapistAsync(CancellationToken ct);
    Task<TherapistInvitation?> LatestInvitationAsync(CancellationToken ct);
    Task<TherapistInvitation?> FindInvitationAsync(string id, CancellationToken ct);
    Task CreateInvitationAsync(TherapistInvitation invitation, EmailJob email, string? replaceInvitationId, CancellationToken ct);
    Task<bool> CancelInvitationAsync(string id, string createdByAccountId, DateTime now, CancellationToken ct);
    Task RegisterTherapistAsync(TherapistInvitation invitation, PrivatePerson person, IdentityAccount account, EmailJob email, DateTime now, CancellationToken ct);
}

public sealed record IdentityAccount
{
    public required string Id { get; init; }
    public required string PersonId { get; init; }
    public required string Role { get; init; }
    public required string DisplayName { get; init; }
    public required string? PasswordHash { get; init; }
    public required string SecurityStamp { get; init; }
    public required byte[] EmailHash { get; init; }
    public required byte[] EmailCiphertext { get; init; }
    public required DateTime CreatedAt { get; init; }
    public bool PersonActive { get; init; } = true;
    public string LinkStatus { get; init; } = "Verified";
    public DateTime? EmailConfirmedAt { get; init; }
    public DateTime? PasskeyEnabledAt { get; init; }
    public bool PasswordSignInRequired { get; init; }
    public byte[]? AuthenticatorSecret { get; init; }
    public DateTime? TwoFactorEnabledAt { get; init; }
    public long? LastTotpStep { get; init; }
    public string RecoveryCodeHashes { get; init; } = "[]";
    public int FailedSignInCount { get; init; }
    public DateTime? LockoutEnd { get; init; }
    public DateTime? ClosedAt { get; init; }
    public ulong Version { get; init; } = 1;
}

public interface IIdentityStore
{
    Task<bool> HasTechnicalManagerAsync(CancellationToken ct);
    Task<IdentityAccount?> FindAsync(string id, CancellationToken ct);
    Task<IdentityAccount?> FindByEmailAsync(byte[] hash, CancellationToken ct);
    Task CreateAsync(PrivatePerson person, IdentityAccount account, EmailJob email, CancellationToken ct);
    Task<bool> UpdateAsync(IdentityAccount account, DateTime now, CancellationToken ct);
    Task QueueConfirmationAsync(EmailJob email, CancellationToken ct);
    Task<bool> IsConfirmationCurrentAsync(string emailId, string accountId, CancellationToken ct);
    Task<string?> LatestEmailStateAsync(string accountId, CancellationToken ct);
    Task<string?> EmailStateAsync(string id, CancellationToken ct);
    Task<EmailJob?> ClaimEmailAsync(DateTime now, CancellationToken ct);
    Task CompleteEmailAsync(string id, string state, DateTime now, CancellationToken ct);
    Task RecoverInterruptedEmailsAsync(DateTime now, CancellationToken ct);
}

public sealed class IdentityProblem(int status, string message, int? retryAfterSeconds = null) : Exception(message)
{
    public int Status { get; } = status;
    public int? RetryAfterSeconds { get; } = retryAfterSeconds;
}
