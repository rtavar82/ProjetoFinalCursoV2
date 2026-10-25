using System.Text.Json.Serialization;

namespace PaCT.Api.Consultations;

public sealed record ConsultationService(string Id, string Title, int DurationMinutes, decimal? ReferencePrice,
    string PaymentMode, string Modality, string PublicLocation, string Instructions, bool Active = true, long Version = 1,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ServiceKind = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ConsultationDelivery[]? BookingOptions = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ServicePresentation? Presentation = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ServicePromotionRevision[]? PromotionHistory = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool DefinedPerEvent = false);
public sealed record ServicePromotionRevision(string AuthorId, DateTimeOffset At, string? PreviousText, string? Text, bool Published);
public sealed record ServicePresentation(string Introduction, string Description, string Recommendations = "", int? PackSessions = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PackPromotion = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool PackPromotionPublished = false);
public sealed record ConsultationDelivery(string Id, string Modality, string PublicLocation, string Instructions,
    decimal? ReferencePrice = null, string? PaymentMode = null, int? DurationMinutes = null);
public sealed record BookingPreviewInput(string ServiceId,
    [property: JsonConverter(typeof(ExplicitInstantConverter))] DateTimeOffset StartsAt,
    long ServiceVersion, string? DeliveryOptionId = null);
public sealed record AvailabilityWindow(string Id,
    [property: JsonConverter(typeof(ExplicitInstantConverter))] DateTimeOffset StartsAt,
    [property: JsonConverter(typeof(ExplicitInstantConverter))] DateTimeOffset EndsAt, bool Available, long Version = 1,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DateTimeOffset? RetiredAt = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ChangedBy = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PublicationId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? SourceWindowId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] AvailabilityConstraints? Rules = null);
public sealed record AvailabilityConstraints(
    [property: JsonConverter(typeof(ExplicitInstantConverter))] DateTimeOffset LastStartAt,
    string? ServiceId = null, string? Modality = null, string? PublicLocation = null, string Audience = "All",
    [property: JsonConverter(typeof(OptionalExplicitInstantConverter))] DateTimeOffset? FirstStartAt = null);
public sealed record AvailabilitySlice(
    [property: JsonConverter(typeof(ExplicitInstantConverter))] DateTimeOffset StartsAt,
    [property: JsonConverter(typeof(ExplicitInstantConverter))] DateTimeOffset EndsAt, bool Available,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] AvailabilityConstraints? Rules = null);
public sealed record AvailabilityPublication(
    [property: JsonConverter(typeof(ExplicitInstantConverter))] DateTimeOffset StartsAt,
    [property: JsonConverter(typeof(ExplicitInstantConverter))] DateTimeOffset EndsAt, string Revision,
    AvailabilitySlice[] Windows, bool ReplaceWholeDays = false, bool ConfirmConflicts = false,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string[]? SelectedDays = null);
public sealed record AvailabilityRange(DateTimeOffset StartsAt, DateTimeOffset EndsAt);
public sealed record AgendaConflict(string Id, DateTimeOffset StartsAt, DateTimeOffset EndsAt, string State);
public sealed record AgendaPublicationPreview(string Revision, DateTimeOffset StartsAt, DateTimeOffset EndsAt,
    int ReplacedWindows, int PreservedParts, AgendaConflict[] Conflicts, AvailabilityRange[]? Ranges = null);
public sealed record PublicAgendaSegment(DateTimeOffset StartsAt, DateTimeOffset EndsAt, string State);
public sealed record Consultation
{
    public required string Id { get; init; }
    public required string PersonId { get; init; }
    public required ConsultationService Service { get; init; }
    public required DateTimeOffset StartsAt { get; init; }
    public required DateTimeOffset EndsAt { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public string State { get; init; } = "Requested";
    public long Version { get; init; } = 1;
    public string? ApprovedBy { get; init; }
    public DateTimeOffset? ApprovedAt { get; init; }
    public string? FinancialChoice { get; init; }
    public bool ExpectationOpen { get; init; }
    public DateTimeOffset? AdvanceSatisfiedAt { get; init; }
    public decimal? AdvanceSatisfiedBalance { get; init; }
    public bool CollectionClosed { get; init; }
    public CollectionDecision[] CollectionHistory { get; init; } = [];
    public PaymentCommunication[] PaymentCommunications { get; init; } = [];
    public decimal ReceivedAmount { get; init; }
    public DateTimeOffset? AcceptedAt { get; init; }
    public string? AcceptedTermsVersion { get; init; }
    public string? AcceptedBy { get; init; }
    public string? AcceptanceReasonCiphertext { get; init; }
    public DateTimeOffset? PaymentDeclaredAt { get; init; }
    public DateTimeOffset? ClosedAt { get; init; }
    public string? ClosedBy { get; init; }
    public DateTimeOffset? ActualStartsAt { get; init; }
    public DateTimeOffset? ActualEndsAt { get; init; }
    public decimal? FinalAmount { get; init; }
    public string? NoDebtReason { get; init; }
    public string? SettlementId { get; init; }
    public string? CancellationOrigin { get; init; }
    public string? CancelledBy { get; init; }
    public DateTimeOffset? CancelledAt { get; init; }
    public bool KeepBlocked { get; init; }
    public DateTimeOffset? AvailabilityDecidedAt { get; init; }
    public string? AvailabilityDecidedBy { get; init; }
    public DateTimeOffset? ArchivedAt { get; init; }
    public long PublicContentVersion { get; init; } = 1;
    public long? ArchivedContentVersion { get; init; }
    public string? ArchivedBy { get; init; }
    public ConsultationRead[] ReadHistory { get; init; } = [];
    public ConsultationNoteRevision[] NoteHistory { get; init; } = [];
    public long ConversationVersion { get; init; } = 1;
    public bool ConversationBlocked { get; init; }
    public ConversationDecision[] ConversationHistory { get; init; } = [];
    public string? SharedNoteCiphertext { get; init; }
    public string? PrivateNoteCiphertext { get; init; }
    public string[] PhotoIds { get; init; } = [];
    public string? OverrideWindowId { get; init; }
    public string? OverrideBy { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? OverrideWindowVersion { get; init; }
}
public sealed record ConsultationRead(string AccountId, long PublicContentVersion, DateTimeOffset At);
public sealed record ConversationDecision(string AccountId, bool Blocked, long Version, DateTimeOffset At);
public sealed record ConsultationMessage(string Id, string ConsultationId, string AuthorId, bool AuthorIsManager,
    long Sequence, DateTimeOffset CreatedAt, string TextCiphertext);
public sealed record ConsultationMessageRead(string Id, string MessageId, string AccountId, DateTimeOffset At);
public sealed record ConsultationNoteRevision(long PublicContentVersion, string Kind, string AuthorId, DateTimeOffset At, string? ContentCiphertext);
public sealed record CollectionDecision(string Id, bool Closed, string AuthorId, DateTimeOffset At, string? ReasonCiphertext);
public sealed record PaymentCommunication(string Id, string? AuthorId, DateTimeOffset At);
public sealed record CreditAllocation(string ReceiptId, decimal Amount);
public sealed record CreditEntry(string Id, string PersonId, string? ConsultationId, string Kind, decimal Amount,
    string AuthorId, DateTimeOffset CreatedAt, string? OriginalId, string? Method, string? ReasonCiphertext,
    DateTimeOffset? EffectiveAt = null, string? Origin = null, string? OriginReference = null,
    CreditAllocation[]? Allocations = null, long Sequence = 0);
public sealed record ConsultationNotice(string Id, string? PersonId, string ConsultationId, string Kind,
    DateTimeOffset DueAt, DateTimeOffset? ExpiresAt, DateTimeOffset? ReadAt = null, bool Cancelled = false,
    string? ClosedBy = null, string? ClosureReason = null);
public sealed class ConsultationData
{
    public List<ConsultationService> Services { get; } = [];
    public List<AvailabilityWindow> Windows { get; } = [];
    public List<Consultation> Consultations { get; } = [];
    public List<GuestConsultationRequest> GuestRequests { get; } = [];
    public List<SessionPack> Packs { get; } = [];
    public List<PackUse> PackUses { get; } = [];
    public List<PackNotice> PackNotices { get; } = [];
    public List<GroupEvent> Events { get; } = [];
    public List<EventParticipation> Participations { get; } = [];
    public List<EventCashEntry> EventCash { get; } = [];
    public List<EventNotice> EventNotices { get; } = [];
    public List<CreditEntry> Entries { get; } = [];
    public List<ConsultationNotice> Notices { get; } = [];
    public List<BalanceNotice> BalanceNotices { get; } = [];
    public List<ConsultationMessage> Messages { get; } = [];
    public List<ConsultationMessageRead> MessageReads { get; } = [];
    public decimal Balance(string personId) => Entries.Where(x => x.PersonId == personId).Sum(x => x.Amount);
}
public sealed record ConsultationCommand
{
    public required string OperationId { get; init; }
    public required string Action { get; init; }
    public string? Id { get; init; }
    public string? PersonId { get; init; }
    public string? ServiceId { get; init; }
    public long Version { get; init; }
    [JsonConverter(typeof(ExplicitInstantConverter))]
    public DateTimeOffset StartsAt { get; init; }
    [JsonConverter(typeof(ExplicitInstantConverter))]
    public DateTimeOffset EndsAt { get; init; }
    public string? Choice { get; init; }
    public string? AvailabilityChoice { get; init; }
    public decimal? Amount { get; init; }
    public string? Method { get; init; }
    public string? Origin { get; init; }
    public string? OriginReference { get; init; }
    public string? Reason { get; init; }
    public bool ConditionsAccepted { get; init; }
    public string? TermsVersion { get; init; }
    public string? SharedNote { get; init; }
    public string? PrivateNote { get; init; }
    public string[] PhotoIds { get; init; } = [];
    public string? OverrideWindowId { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? OverrideWindowVersion { get; init; }
    public ConsultationService? Service { get; init; }
    public AvailabilityWindow? Window { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public AvailabilityPublication? Publication { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public PackPurchaseInput? PackPurchase { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? PackId { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? PackUseId { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? ExtensionMonths { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Quantity { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonConverter(typeof(OptionalExplicitInstantConverter))]
    public DateTimeOffset? ValidUntil { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public EventInput? Event { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? RelatedId { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Method2 { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? PublicContentVersion { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? ConversationVersion { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? MessageText { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string[]? MessageIds { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? ServiceVersion { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? DeliveryOptionId { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? DurationMinutes { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ManualReviewRevision { get; init; }
}
public sealed record ConsultationActor(string AccountId, string PersonId, bool IsManager);
public sealed record BalanceNotice(string Id, string PersonId, decimal Amount, DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt, DateTimeOffset? ClosedAt = null, DateTimeOffset? ClientReadAt = null,
    DateTimeOffset? ManagerReadAt = null, DateTimeOffset? PushSentAt = null,
    string PushState = "Pending", DateTimeOffset? PushAttemptedAt = null);
public sealed record ConsultationResult(string Id, string Message,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? OperationId = null);
