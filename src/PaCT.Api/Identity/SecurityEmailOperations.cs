namespace PaCT.Api.Identity;

public sealed record SecurityEmailTransportStatus(bool Available, string Category, string Message);

public sealed record SecurityEmailHealthSnapshot(
    SecurityEmailTransportStatus Transport,
    DateTime? LastConfigurationCheckAt,
    DateTime? LastWorkerActivityAt,
    string? LastFailureCategory,
    DateTime? LastFailureAt,
    string? LastOutcomeState,
    DateTime? LastOutcomeAt);

public sealed class SecurityEmailHealth
{
    private readonly object gate = new();
    private SecurityEmailTransportStatus transport = new(false, "NotChecked", "O estado do envio de emails ainda não foi verificado.");
    private DateTime? lastConfigurationCheckAt;
    private DateTime? lastWorkerActivityAt;
    private string? lastFailureCategory;
    private DateTime? lastFailureAt;
    private string? lastOutcomeState;
    private DateTime? lastOutcomeAt;

    public void ObserveConfiguration(SecurityEmailTransportStatus status, DateTime at)
    {
        lock (gate)
        {
            transport = status;
            lastConfigurationCheckAt = at;
        }
    }

    public void RecordWorkerActivity(DateTime at)
    {
        lock (gate)
        {
            lastWorkerActivityAt = at;
            lastFailureCategory = null;
            lastFailureAt = null;
        }
    }

    public void RecordFailure(string category, DateTime at)
    {
        lock (gate)
        {
            lastFailureCategory = category;
            lastFailureAt = at;
        }
    }

    public void RecordOutcome(string state, DateTime at)
    {
        lock (gate)
        {
            lastOutcomeState = state;
            lastOutcomeAt = at;
        }
    }

    public SecurityEmailHealthSnapshot Snapshot()
    {
        lock (gate)
            return new(transport, lastConfigurationCheckAt, lastWorkerActivityAt, lastFailureCategory, lastFailureAt, lastOutcomeState, lastOutcomeAt);
    }
}

public sealed record SecurityEmailQueueItem(string Id, string State, DateTime CreatedAt, DateTime? AttemptedAt, DateTime UpdatedAt, int ReviewCount);

public sealed record SecurityEmailQueueSnapshot(
    int Pending,
    int Sending,
    int Submitted,
    int Failed,
    int Uncertain,
    int Cancelled,
    IReadOnlyList<SecurityEmailQueueItem> UncertainItems);

public sealed record SecurityEmailReviewReceipt(string EmailId, string OperationId, bool AlreadyRecorded);

public interface ISecurityEmailOperationsStore
{
    Task<SecurityEmailQueueSnapshot> ReadEmailQueueAsync(CancellationToken ct);
    Task<SecurityEmailReviewReceipt> RecordReviewAsync(string emailId, string operationId, string managerAccountId, DateTime now, CancellationToken ct);
}
