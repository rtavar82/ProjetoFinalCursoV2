using PaCT.Api.Identity;

namespace PaCT.Api.Clients;

public sealed record ClientProfile(string? FirstName = null, string? LastName = null, string? Locality = null,
    DateOnly? BirthDate = null, string? Gender = null, string? Email = null, string? DialCode = null,
    string? Phone = null, string? Address = null, string? PostalCode = null, int? ChildrenCount = null,
    string? RelationshipStatus = null, string? DisplayName = null);
public sealed record ProfileChange(ClientProfile Data, ulong Version);
public sealed record FirstPassword(string Password, string ConfirmPassword);
public sealed record RegistrationReviewStatus(string Token);
public sealed record NoteChange(string Title, string Text, ulong Version = 0);
public sealed record ReviewDecision(ulong Version, bool Accept, string? CandidateId = null, ulong? CandidateVersion = null,
    string[]? SelectedFields = null, ulong? SourceVersion = null, string? PrimaryPersonId = null);
public sealed record StoredClient(string Id, ClientProfile PublicData, IReadOnlyDictionary<string, byte[]> PrivateData, byte[]? EmailHash,
    byte[]? PhoneHash, string? AccountId, string? AccountState, DateTime CreatedAt, DateTime UpdatedAt, ulong Version, string? IdentityReviewStatus = null, bool IsActive = true);
public sealed record ClientReview(string Id, string Kind, string? PersonId, byte[] Proposal, string[] Candidates,
    string Status, string? AuthorId, DateTime CreatedAt, ulong SourceVersion, ulong Version = 1,
    string? DecidedBy = null, DateTime? DecidedAt = null, string? AssociatedPersonId = null, string[]? SelectedFields = null);
public sealed record ClientNote(string Id, string PersonId, byte[] Content, string CreatedBy, string UpdatedBy,
    DateTime CreatedAt, DateTime UpdatedAt, ulong Version = 1);
public sealed record ReviewProposal(ClientProfile Data,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Origin = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] ClientAggregationItem[]? Aggregation = null);
public sealed record ClientView(string Id, ClientProfile Data, bool HasAccount, string? AccountState,
    bool IsComplete, DateTime CreatedAt, DateTime UpdatedAt, ulong Version, string? IdentityReviewStatus = null);
public sealed record ClientSaveResult(bool Saved, bool UnderReview, string Message, ClientView? Client = null, string? ReviewToken = null);
public sealed record StoredClientName(string Id, byte[]? FirstName, byte[]? LastName);

public interface IClientStore
{
    Task<T> ExecuteAsync<T>(Func<IClientSession, Task<T>> action, bool write, CancellationToken ct);
}
public interface IClientSession
{
    Task<ClientCommandReceipt?> CommandAsync(string id);
    Task SaveCommandAsync(ClientCommandReceipt receipt);
    Task<IReadOnlyList<StoredClient>> ClientsAsync();
    Task<IReadOnlyList<StoredClientName>> ClientNamesAsync(string[] ids);
    Task<IReadOnlyList<ClientReview>> ReviewsAsync();
    Task<int> OpenReviewCountAsync();
    Task<IReadOnlyList<ClientNote>> NotesAsync(string personId);
    Task SaveClientAsync(StoredClient client, bool create);
    Task SaveReviewAsync(ClientReview review, bool create);
    Task SaveNoteAsync(ClientNote note, bool create);
    Task CreateRegistrationAsync(PrivatePerson person, IdentityAccount account, EmailJob email);
    Task QueueSetupEmailAsync(IdentityAccount account, EmailJob email);
    Task<ClientAggregationItem[]> ConsolidateAsync(StoredClient primary, StoredClient absorbed, DateTime now, string authorId);
}
