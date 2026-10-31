using System.Text.Json.Serialization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public sealed record EventInput(string ServiceId,
    [property: JsonConverter(typeof(ExplicitInstantConverter))] DateTimeOffset StartsAt,
    [property: JsonConverter(typeof(ExplicitInstantConverter))] DateTimeOffset EndsAt,
    string PublicLocation, int Capacity, bool Published, string[]? AllowedPersonIds = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Program = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] decimal? TotalPrice = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? CancellationConditions = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool Promoted = false,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PromotionText = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? BillingMode = null);
public sealed record RetreatReturn(string Id, decimal Amount, string Method, DateTimeOffset EffectiveAt, string AuthorId, DateTimeOffset CreatedAt, string EntryId);
public sealed record EventRevision(string AuthorId, DateTimeOffset At, string Action, EventInput Before, EventInput After);
public sealed record EventBlockOverride(string WindowId, long WindowVersion, string AuthorId, DateTimeOffset At, DateTimeOffset StartsAt, DateTimeOffset EndsAt);
public sealed record GroupEvent(string Id, ConsultationService Service, EventInput Definition, string CreatedBy, DateTimeOffset CreatedAt,
    long Version = 1, string State = "Scheduled", long ScheduleVersion = 1, bool KeepBlocked = false,
    DateTimeOffset? ActualStartsAt = null, DateTimeOffset? ActualEndsAt = null, EventRevision[]? History = null, EventBlockOverride[]? Overrides = null,
    [property: JsonRequired] ProcessStage Stage = ProcessStage.Booking, ProcessStageChange[]? StageHistory = null);
public sealed record ParticipationDecision(string Action, string AuthorId, DateTimeOffset At, decimal? Amount = null, string? ReasonCiphertext = null);
public sealed record EventParticipation(string Id, string EventId, string? PersonId, string State, DateTimeOffset CreatedAt,
    long Version = 1, bool ProtectedSeat = false, DateTimeOffset? ConfirmedAt = null, long ConfirmedScheduleVersion = 1,
    string? Attendance = null, string? FinancialChoice = null, decimal? FinalAmount = null, string? SettlementId = null,
    string? SharedSummaryCiphertext = null, string? PrivateNoteCiphertext = null, string? GuestContactCiphertext = null,
    ParticipationDecision[]? History = null, string? GuestOperationId = null, string? GuestRequestHash = null,
    decimal? AgreedTotal = null, decimal? ReturnDue = null, RetreatReturn[]? Returns = null, string? CancellationBy = null, string? ReturnReasonCiphertext = null,
    DateTimeOffset? ArchivedAt = null, string? ArchivedBy = null, long PublicContentVersion = 1, long? ArchivedContentVersion = null,
    ConsultationRead[]? ReadHistory = null, [property: JsonRequired] ProcessStage Stage = ProcessStage.Request, ProcessStageChange[]? StageHistory = null,
    DateTimeOffset? AcceptedAt = null, string? AcceptedTermsVersion = null, string? AcceptedBy = null,
    bool ExpectationOpen = false, DateTimeOffset? AdvanceSatisfiedAt = null,
    ConsultationConditionSet? AcceptedConditions = null, decimal SettledAmount = 0, CreditUseProposal[]? CreditProposals = null, decimal? AdvanceSatisfiedBalance = null);
public sealed record EventCashEntry(string Id, string EventId, string ParticipationId, decimal Amount, string Method, DateTimeOffset EffectiveAt, string AuthorId, DateTimeOffset CreatedAt);
public sealed record EventNotice(string Id, string EventId, string ParticipationId, string? PersonId, string Kind, long ScheduleVersion,
    DateTimeOffset DueAt, DateTimeOffset? ExpiresAt, bool Cancelled = false, DateTimeOffset? ReadAt = null,
    DateTimeOffset? EmailQueuedAt = null, string? PushState = null, bool EmailPending = false);

public static class GroupEvents
{
    private static void Require(bool value, string message, int status = 400) { if (!value) throw new IdentityProblem(status, message); }
    private static void Manager(ConsultationActor actor) => Require(actor.IsManager, "Esta ação exige a gestora-terapeuta.", 403);
    public static bool IsFree(ConsultationService service) => service.ServiceKind == "Group" && service.PaymentMode == "Free";
    private static void ValidateFreeParticipation(ConsultationService service, ConsultationCommand input)
    {
        if (IsFree(service))
            Require(input.Method == "NoCharge" && input.Amount is null or 0 && string.IsNullOrEmpty(input.PackId),
                "A participação neste grupo é gratuita. Não permite cobrança, recebimento ou utilização de sessões de pack.");
    }
    public static bool Occupies(GroupEvent item) => item.State != "Cancelled" || item.KeepBlocked;
    public static decimal AmountDue(ConsultationData data, EventParticipation p) => data.Events.Single(e => e.Id == p.EventId).Service.ServiceKind == "Retreat"
        ? RetreatFinance.Remaining(data, p) : p.State == "Confirmed" && p.FinancialChoice == "Unpaid" && p.SettlementId is null ? Math.Max(0, (p.FinalAmount ?? 0) - p.SettledAmount) : 0;
    public static int Seats(ConsultationData data, string eventId) => data.Participations.Count(p => p.EventId == eventId && (p.State is "Confirmed" or "Requested" || p.ProtectedSeat));
    public static bool Eligible(GroupEvent item, string person) => item.Definition.AllowedPersonIds is not { Length: > 0 } || item.Definition.AllowedPersonIds.Contains(person);
    private static bool Money(decimal? amount) => amount is >= .01m and <= 1000000m && decimal.Round(amount.Value, 2) == amount;
    public static ConsultationResult SubmitGuest(ConsultationData data, string eventId, GuestSubmission raw, DateTimeOffset now, Func<string, string, string, string> encrypt)
    {
        var input = GuestConsultations.Normalize(raw, requireLocality: false);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { eventId, input }))));
        var previous = data.Participations.SingleOrDefault(p => p.GuestOperationId == input.OperationId);
        if (previous is not null)
        {
            Require(previous.GuestRequestHash == hash, "Esta identificação já foi usada para outro pedido.", 409);
            return new(previous.Id, "Pedido recebido. Aguarda o contacto da terapeuta.");
        }
        input = GuestConsultations.Normalize(input);
        var item = data.Events.SingleOrDefault(e => e.Id == eventId && e.Definition.Published && e.State == "Scheduled") ?? throw new IdentityProblem(404, "Evento não encontrado.");
        Require(item.Definition.StartsAt > now && item.Service.Id == input.ServiceId && item.Definition.StartsAt == input.StartsAt, "O evento mudou ou já começou.", 409);
        Require(item.Definition.AllowedPersonIds is not { Length: > 0 }, "Esta inscrição exige contacto direto com a gestão.", 403);
        Require(Seats(data, item.Id) < item.Definition.Capacity, "Não existem vagas disponíveis.", 409);
        var id = Guid.NewGuid().ToString();
        data.Participations.Add(new(id, eventId, Guid.NewGuid().ToString(), "Requested", now, GuestContactCiphertext: encrypt(id, "event-contact", JsonSerializer.Serialize(new GuestContact(input.FirstName, input.LastName, input.DialCode, input.Phone, input.Email, input.Locality))), GuestOperationId: input.OperationId, GuestRequestHash: hash));
        Touch(data, item); return new(id, "Pedido recebido. Aguarda o contacto da terapeuta.");
    }
    public static ConsultationResult Apply(ConsultationData data, ConsultationCommand input, ConsultationActor actor, DateTimeOffset now, Func<string, string, string, string> encrypt)
    {
        if (input.Action == "SaveEvent")
        {
            Manager(actor); var definition = input.Event ?? throw new IdentityProblem(400, "Preenche o evento.");
            var existing = input.Id is null ? null : data.Events.SingleOrDefault(e => e.Id == input.Id) ?? throw new IdentityProblem(404, "Evento não encontrado.");
            Require(existing is null || existing.Version == input.Version && existing.State == "Scheduled", "O evento mudou ou já foi encerrado.", 409);
            var service = existing?.Service ?? ActivityCatalogue.Complete(data.Services).SingleOrDefault(s => s.Id == definition.ServiceId && s.Active && s.ServiceKind is "Group" or "Retreat") ?? throw new IdentityProblem(400, "Seleciona um serviço de grupo ou retiro.");
            Require(definition.ServiceId == service.Id, "Não alteres o serviço de um evento existente.");
            SharingWorkshop.ValidateService(service);
            GroupPaymentConditions.ValidateDefinition(definition, service, existing, data);
            Require((definition.PromotionText?.Length ?? 0) <= 2000, "O texto de divulgação pode ter até 2000 caracteres.");
            Require(!definition.Promoted || input.ConditionsAccepted, "Confirma expressamente a publicação da divulgação revista.");
            if (service.ServiceKind == "Retreat") RetreatFinance.ValidateDefinition(definition, service);
            Require(definition.StartsAt > now && definition.EndsAt > definition.StartsAt && AgendaRules.IsBookableStart(definition.StartsAt, now), "Indica um evento futuro dentro do horizonte da agenda.");
            Require(definition.Capacity is >= 1 and <= 10000, "Indica uma lotação entre 1 e 10000.");
            Require(definition.AllowedPersonIds is null || definition.AllowedPersonIds.Length <= 1000 && definition.AllowedPersonIds.All(id => Guid.TryParse(id, out _)) && definition.AllowedPersonIds.Distinct().Count() == definition.AllowedPersonIds.Length, "Revê as fichas autorizadas.");
            definition = definition with { StartsAt = definition.StartsAt.ToUniversalTime(), EndsAt = definition.EndsAt.ToUniversalTime(), PublicLocation = IdentityValidation.Required(definition.PublicLocation, 300, "o local público") };
            Require(service.PaymentMode != "Free" || definition.TotalPrice is null or 0, "A participação gratuita não tem preço nem contribuição.");
            if (service.DefinedPerEvent)
            {
                Require(service.PaymentMode is "Free" or "Contribution" || Money(definition.TotalPrice), "Indica o preço por participante desta ocorrência.");
                var price = service.PaymentMode == "Free" ? 0 : service.PaymentMode == "Contribution" ? (decimal?)null : definition.TotalPrice;
                Require(existing is null || !data.Participations.Any(p => p.EventId == existing.Id && p.State == "Confirmed")
                    || existing.Service.ReferencePrice == price, "O preço não pode mudar depois de existirem inscrições confirmadas.", 409);
                service = service with { ReferencePrice = price, PublicLocation = definition.PublicLocation };
            }
            AgendaRules.ValidateOccupation(data, definition.StartsAt, definition.EndsAt, now, excludingEventId: existing?.Id);
            var blocks = AgendaRules.ActiveWindows(data).Where(w => !w.Available && AgendaRules.Overlaps(definition.StartsAt, definition.EndsAt, w.StartsAt, w.EndsAt)).ToArray();
            Require(blocks.Length == 0 || blocks.Length == 1 && input.OverrideWindowId == blocks[0].Id && input.OverrideWindowVersion == blocks[0].Version, "O bloqueio pessoal exige autorização explícita da versão atual.", 409);
            Require(existing is null || Seats(data, existing.Id) <= definition.Capacity, "A lotação não pode ficar abaixo das vagas ocupadas ou provisórias.", 409);
            Require(existing is null || service.ServiceKind != "Retreat" || !data.Participations.Any(p => p.EventId == existing.Id && p.State == "Confirmed")
                || RetreatFinance.Price(existing) == (definition.TotalPrice ?? service.ReferencePrice), "O preço único não pode mudar depois de existirem inscrições confirmadas.", 409);
            var item = existing is null ? new(Guid.NewGuid().ToString(), service, definition, actor.AccountId, now) : existing with { Definition = definition, Version = existing.Version + 1,
                Stage = ProcessStage.Booking, StageHistory = existing.Stage == ProcessStage.Consultation
                    ? [..existing.StageHistory ?? [], new(existing.Stage, ProcessStage.Booking, now, actor.AccountId)] : existing.StageHistory,
                ScheduleVersion = existing.ScheduleVersion + (existing.Definition.StartsAt != definition.StartsAt || existing.Definition.EndsAt != definition.EndsAt || existing.Definition.PublicLocation != definition.PublicLocation ? 1 : 0),
                History = [..existing.History ?? [], new(actor.AccountId, now, "Edit", existing.Definition, definition)] };
            if (blocks.Length > 0) item = item with { Overrides = [..item.Overrides ?? [], new(blocks[0].Id, blocks[0].Version, actor.AccountId, now, definition.StartsAt, definition.EndsAt)] };
            if (!data.Services.Any(s => s.Id == service.Id) && ActivityCatalogue.IsBuiltIn(service.Id))
                data.Services.Add(ActivityCatalogue.Types().Single(type => type.Id == service.Id));
            if (existing is null) data.Events.Add(item); else data.Events[data.Events.FindIndex(e => e.Id == item.Id)] = item;
            if (existing is not null && existing.ScheduleVersion != item.ScheduleVersion)
                for (var i = 0; i < data.Participations.Count; i++)
                {
                    var p = data.Participations[i];
                    if (p.EventId == item.Id && p.State == "Confirmed") data.Participations[i] = p with { ConfirmedAt = now, ConfirmedScheduleVersion = item.ScheduleVersion,
                        Stage = ProcessStage.Booking, StageHistory = p.Stage == ProcessStage.Consultation ? [..p.StageHistory ?? [], new(p.Stage, ProcessStage.Booking, now, actor.AccountId)] : p.StageHistory,
                        Version = p.Version + 1, History = [..p.History ?? [], new("ScheduleChanged", actor.AccountId, now)] };
                }
            return new(item.Id, "Evento guardado.");
        }
        if (input.Action is "CancelEvent" or "PerformEvent")
        {
            Manager(actor); var index = data.Events.FindIndex(e => e.Id == input.Id); Require(index >= 0, "Evento não encontrado.", 404); var item = ProcessLifecycle.At(data.Events[index], now);
            Require(item.Version == input.Version && item.State == "Scheduled", "O evento mudou ou já foi encerrado.", 409);
            if (input.Action == "CancelEvent")
            {
                Require(input.AvailabilityChoice is "Release" or "Keep", "Escolhe o destino do horário.");
                data.Events[index] = item with { State = "Cancelled", KeepBlocked = input.AvailabilityChoice == "Keep", Version = item.Version + 1, ScheduleVersion = item.ScheduleVersion + 1,
                    History = [..item.History ?? [], new(actor.AccountId, now, "Cancel", item.Definition, item.Definition)] };
                for (var i = 0; i < data.Participations.Count; i++)
                {
                    var p = ProcessLifecycle.At(item, data.Participations[i], now);
                    if (p.EventId != item.Id) continue;
                    if (p.State == "Cancelled")
                    {
                        data.Participations[i] = p with { ProtectedSeat = false, Version = p.Version + 1,
                            History = [..p.History ?? [], new("EventCancelledAfterWithdrawal", actor.AccountId, now)] };
                        continue;
                    }
                    data.Participations[i] = p with { State = "Cancelled", ProtectedSeat = false, CancellationBy = "Organizer",
                        CreditProposals = FinancialProposals.End(p.CreditProposals ?? [], actor.AccountId, now),
                        ReturnDue = item.Service.ServiceKind == "Retreat" ? RetreatFinance.Applied(data, p) : p.ReturnDue,
                        Version = p.Version + 1, History = [..p.History ?? [], new("OrganizerCancellation", actor.AccountId, now)] };
                }
            }
            else
            {
                Require(item.Definition.StartsAt <= now && input.StartsAt > DateTimeOffset.UnixEpoch && input.EndsAt > input.StartsAt && input.EndsAt <= now, "Indica o horário efetivo já ocorrido.");
                data.Events[index] = item with { State = "Performed", ActualStartsAt = input.StartsAt, ActualEndsAt = input.EndsAt, Version = item.Version + 1,
                    History = [..item.History ?? [], new(actor.AccountId, now, "Perform", item.Definition, item.Definition)] };
            }
            return new(item.Id, input.Action == "CancelEvent" ? "Evento cancelado. Os registos financeiros foram mantidos." : "Realização registada. Regista a presença de cada participante.");
        }
        if (input.Action == "ReleaseEventBlock")
        {
            Manager(actor); var index = data.Events.FindIndex(e => e.Id == input.Id); Require(index >= 0, "Evento não encontrado.", 404); var item = data.Events[index];
            Require(item.State == "Cancelled" && item.KeepBlocked && item.Version == input.Version, "Este bloqueio já mudou.", 409);
            data.Events[index] = item with { KeepBlocked = false, Version = item.Version + 1,
                History = [..item.History ?? [], new(actor.AccountId, now, "ReleaseBlock", item.Definition, item.Definition)] }; return new(item.Id, "Horário disponibilizado.");
        }
        if (input.Action == "JoinEvent")
        {
            var item = ProcessLifecycle.At(data.Events.SingleOrDefault(e => e.Id == input.Id) ?? throw new IdentityProblem(404, "Evento não encontrado."), now);
            Require(item.Version == input.Version && (item.State == "Scheduled" && item.Definition.StartsAt > now || actor.IsManager && item.State == "Performed"), "O evento mudou ou já não permite inscrições.", 409);
            Require(actor.IsManager || item.Definition.Published, "O evento não está publicado.", 409);
            var person = actor.IsManager ? input.PersonId : actor.PersonId;
            Require(Guid.TryParse(person, out _) || actor.IsManager && input.Choice == "Anonymous", "Seleciona a ficha do participante.");
            Require(item.Service.ServiceKind != "Retreat" || person is not null, "A inscrição num retiro exige uma ficha, mesmo sem conta.");
            Require(input.Choice != "Anonymous" || actor.IsManager && person is null && item.State == "Performed" && input.Method is "NoCharge" or "AnonymousPaid", "A participação anónima exige realização registada e fecho sem dívida ou com pagamento integral confirmado.");
            if (input.Choice == "Anonymous") ValidateFreeParticipation(item.Service, input);
            Require(actor.IsManager || Eligible(item, person!), "Esta inscrição exige autorização da terapeuta.", 403);
            Require(person is null || !data.Participations.Any(p => p.EventId == item.Id && p.PersonId == person && p.State is "Confirmed" or "Waiting" or "Requested"), "Esta pessoa já tem uma inscrição ativa.", 409);
            var waiting = actor.IsManager && input.Choice == "Waiting";
            var financialAcceptance = !actor.IsManager && !IsFree(item.Service) && item.Service.ServiceKind == "Group";
            if (financialAcceptance) GroupPaymentConditions.ValidateAcceptance(item, input);
            Require(actor.IsManager || input.Amount is null || financialAcceptance && GroupPaymentConditions.Mode(item) == "Prepayment", "A proposta de crédito exige uma inscrição com pré-pagamento.");
            Require(waiting || Seats(data, item.Id) < item.Definition.Capacity, "Não existem vagas. Revê a lotação antes de confirmar.", 409);
            var p = new EventParticipation(Guid.NewGuid().ToString(), item.Id, person, waiting ? "Waiting" : "Confirmed", now,
                ConfirmedAt: waiting ? null : now, ConfirmedScheduleVersion: item.ScheduleVersion, History: [new("Join", actor.AccountId, now)],
                AgreedTotal: !waiting && item.Service.ServiceKind == "Retreat" ? RetreatFinance.Price(item) : financialAcceptance ? item.Service.ReferencePrice : null,
                FinancialChoice: !waiting && item.Service.ServiceKind == "Retreat" ? "Unpaid" : null,
                FinalAmount: !waiting && item.Service.ServiceKind == "Retreat" ? RetreatFinance.Price(item) : null,
                AcceptedAt: financialAcceptance ? now : null, AcceptedBy: financialAcceptance ? actor.AccountId : null,
                AcceptedTermsVersion: financialAcceptance ? GroupPaymentConditions.Describe(item).Version : null,
                AcceptedConditions: financialAcceptance ? GroupPaymentConditions.Describe(item) : null,
                ExpectationOpen: !waiting && GroupPaymentConditions.Mode(item) == "Prepayment" && !IsFree(item.Service),
                Stage: waiting ? ProcessStage.Request : item.Stage,
                StageHistory: waiting ? [] : item.Stage == ProcessStage.Consultation
                    ? [new(ProcessStage.Request, ProcessStage.Booking, now, actor.AccountId), new(ProcessStage.Booking, ProcessStage.Consultation, now, actor.AccountId)]
                    : [new(ProcessStage.Request, ProcessStage.Booking, now, actor.AccountId)]);
            if (!actor.IsManager && input.Amount is not null)
            {
                p = p with { CreditProposals = FinancialProposals.Create([], input, actor, now, data.Balance(person!), item.Service.ReferencePrice ?? 0) };
                data.EventNotices.Add(new(Guid.NewGuid().ToString(), item.Id, p.Id, null, "CreditProposal:" + input.OperationId, item.ScheduleVersion, now, null));
            }
            data.Participations.Add(p); Touch(data, item);
            if (financialAcceptance) GroupPaymentConditions.AcceptanceNotice(data, item, p, now);
            data.EventNotices.Add(new(Guid.NewGuid().ToString(), item.Id, p.Id, null, "EventNewRegistration", item.ScheduleVersion, now, null, PushState: "Pending"));
            if (input.Choice == "Anonymous") return Apply(data, input with { Action = "CloseParticipation", Id = p.Id, Version = p.Version, Choice = "Performed" }, actor, now, encrypt);
            return new(p.Id, waiting ? "Inscrição colocada em espera." : "Inscrição confirmada.");
        }
        var pi = data.Participations.FindIndex(p => p.Id == input.Id && (actor.IsManager || p.PersonId == actor.PersonId)); Require(pi >= 0, "Inscrição não encontrada.", 404);
        var ev = ProcessLifecycle.At(data.Events.Single(e => e.Id == data.Participations[pi].EventId), now);
        var current = ProcessLifecycle.At(ev, data.Participations[pi], now);
        Require(current.Version == input.Version, "A inscrição mudou. Revê a informação atual.", 409); var next = current;
        if (input.Action == "LinkEventGuest")
        {
            Manager(actor); Require(current.State == "Requested" && ev.State == "Scheduled" && now < ev.Definition.StartsAt, "Este pedido já foi tratado ou expirou.", 409);
            Require(Guid.TryParse(input.PersonId, out _) && input.ConditionsAccepted, "Seleciona a ficha e confirma que verificaste a identidade.");
            Require(!data.Participations.Any(p => p.EventId == ev.Id && p.PersonId == input.PersonId && p.State is "Confirmed" or "Waiting"), "Esta pessoa já tem uma inscrição ativa.", 409);
            Require(Seats(data, ev.Id) <= ev.Definition.Capacity, "Revê a lotação antes de confirmar.", 409);
            next = current with { PersonId = input.PersonId, State = "Confirmed", Stage = ProcessStage.Booking,
                StageHistory = [..current.StageHistory ?? [], new(current.Stage, ProcessStage.Booking, now, actor.AccountId)], ConfirmedAt = now, ConfirmedScheduleVersion = ev.ScheduleVersion,
                AgreedTotal = ev.Service.ServiceKind == "Retreat" ? RetreatFinance.Price(ev) : null,
                FinancialChoice = ev.Service.ServiceKind == "Retreat" ? "Unpaid" : null,
                FinalAmount = ev.Service.ServiceKind == "Retreat" ? RetreatFinance.Price(ev) : null };
        }
        else if (input.Action == "RejectEventGuest")
        { Manager(actor); Require(current.State == "Requested", "Este pedido já foi tratado.", 409); next = current with { State = "Cancelled", CancellationBy = "Rejected" }; }
        else if (input.Action == "CancelParticipation")
        {
            Require(current.State is "Confirmed" or "Waiting" && current.Attendance is null, "Esta inscrição já não permite cancelamento.", 409);
            Require(actor.IsManager || ev.State == "Scheduled" && now < ev.Definition.StartsAt, "A sessão já começou ou foi encerrada. Contacta a terapeuta.", 409);
            Require(!actor.IsManager || ev.Service.ServiceKind != "Retreat" || input.AvailabilityChoice is "Release" or "Keep", "Escolhe se a vaga fica protegida ou pública.");
            next = current with { State = "Cancelled", ProtectedSeat = ev.Service.ServiceKind == "Retreat" && current.State == "Confirmed" && (!actor.IsManager || input.AvailabilityChoice == "Keep"), CancellationBy = "Participant",
                CreditProposals = FinancialProposals.End(current.CreditProposals ?? [], actor.AccountId, now) };
            data.EventNotices.Add(new(Guid.NewGuid().ToString(), ev.Id, current.Id, null, "EventParticipantCancelled", ev.ScheduleVersion, now, null, PushState: "Pending"));
        }
        else if (input.Action == "ReleaseEventSeat")
        { Manager(actor); Require(current.ProtectedSeat, "Esta vaga já foi libertada.", 409); next = current with { ProtectedSeat = false }; }
        else if (input.Action == "ConfirmParticipation")
        {
            Manager(actor); Require(ev.State == "Scheduled" && ev.Definition.StartsAt > now && current.State == "Waiting", "A inscrição já não está em espera.", 409);
            var protectedSource = input.RelatedId is null ? null : data.Participations.SingleOrDefault(p => p.Id == input.RelatedId && p.EventId == ev.Id && p.ProtectedSeat);
            Require(input.RelatedId is null || protectedSource is not null, "A vaga protegida mudou.", 409);
            Require(protectedSource is not null || Seats(data, ev.Id) < ev.Definition.Capacity, "Não existem vagas disponíveis.", 409);
            if (protectedSource is not null) data.Participations[data.Participations.FindIndex(p => p.Id == protectedSource.Id)] = protectedSource with { ProtectedSeat = false, Version = protectedSource.Version + 1, History = [..protectedSource.History ?? [], new("SeatAssigned", actor.AccountId, now)] };
            next = current with { State = "Confirmed", Stage = ProcessStage.Booking,
                StageHistory = [..current.StageHistory ?? [], new(current.Stage, ProcessStage.Booking, now, actor.AccountId)], ConfirmedAt = now, ConfirmedScheduleVersion = ev.ScheduleVersion,
                AgreedTotal = ev.Service.ServiceKind == "Retreat" ? RetreatFinance.Price(ev) : null,
                FinancialChoice = ev.Service.ServiceKind == "Retreat" ? "Unpaid" : null,
                FinalAmount = ev.Service.ServiceKind == "Retreat" ? RetreatFinance.Price(ev) : null };
        }
        else if (input.Action == "CloseParticipation")
        {
            Manager(actor); Require(ev.State == "Performed" && current.State == "Confirmed" && current.Attendance is null, "Regista primeiro a realização do evento. A presença só pode ser fechada uma vez.", 409);
            Require(input.Choice is "Performed" or "NoShow", "Escolhe presença ou falta.");
            ValidateFreeParticipation(ev.Service, input);
            Require(ev.Service.ServiceKind != "Retreat" || input.Method != "Pack", "Retiros não podem utilizar sessões de pack.");
            Require(ev.Service.ServiceKind == "Retreat" || input.Choice != "NoShow" || input.Method == "NoCharge", "A falta a uma consulta de grupo fica sem dívida e não consome saldo ou pack.");
            Require(ev.Service.ServiceKind != "Retreat" || input.Method == "Unpaid" && (input.Amount is null || input.Amount == (current.AgreedTotal ?? RetreatFinance.Price(ev))), "A presença não altera o preço ou os pagamentos do retiro.");
            Require(input.Method is "Unpaid" or "Settle" or "Undefined" or "NoCharge" or "Pack" or "AnonymousPaid", "Escolhe o tratamento financeiro.");
            Require(input.Method != "Undefined" || ev.Service.ServiceKind == "Group" && GroupPaymentConditions.Mode(ev) == "Contribution" && input.Choice == "Performed" && current.PersonId is not null && input.Amount is null, "Só a contribuição livre de uma participação realizada com ficha pode ficar por definir.");
            Require(input.SettlementAmount is null || input.Method == "Settle" && input.Choice == "Performed", "A utilização de crédito exige uma participação realizada e liquidação monetária.");
            Require(input.Method != "Settle" || ev.Service.ServiceKind != "Retreat" && input.Choice == "Performed" && current.PersonId is not null, "Só a participação realizada com ficha pode ser liquidada no fecho.");
            Require(input.Method != "Pack" || input.Choice == "Performed", "Uma falta nunca consome sessões de pack.");
            Require(ev.Service.ServiceKind == "Retreat" || input.Method is "NoCharge" or "Pack" or "Undefined" || Money(input.Amount), "Indica um valor positivo.");
            Require(current.PersonId is not null || input.Method is "NoCharge" or "AnonymousPaid", "Uma participação sem ficha não pode ter dívida nem usar crédito ou pack.");
            Require(input.Method != "AnonymousPaid" || current.PersonId is null && input.Method2 is "Cash" or "Transfer" or "MbWay" or "Card" or "Other", "Regista o meio do recebimento integral anónimo.");
            Require((input.SharedNote?.Length ?? 0) <= 8000 && (input.PrivateNote?.Length ?? 0) <= 8000, "As notas podem ter até 8000 caracteres.");
            Require(input.Choice == "Performed" || string.IsNullOrWhiteSpace(input.SharedNote), "A partilha de acompanhamento exige presença.");
            if (input.Method == "Pack") SessionPacks.Consume(data, input.PackId ?? "", current.PersonId!, current.Id, ev.Service.Id, "EventParticipation", ev.ActualStartsAt!.Value, actor, now);
            if (input.Method == "AnonymousPaid")
            {
                Require(input.StartsAt > DateTimeOffset.UnixEpoch && input.StartsAt <= now, "Indica a data do recebimento efetivo.");
                data.EventCash.Add(new(Guid.NewGuid().ToString(), ev.Id, current.Id, input.Amount!.Value, input.Method2!, input.StartsAt, actor.AccountId, now));
            }
            next = current with { Attendance = input.Choice, FinancialChoice = ev.Service.ServiceKind == "Retreat" ? current.FinancialChoice : input.Method is "Settle" or "Undefined" ? "Unpaid" : input.Method,
                FinalAmount = ev.Service.ServiceKind == "Retreat" ? current.FinalAmount : input.Method is "NoCharge" or "Pack" ? 0 : input.Amount,
                SharedSummaryCiphertext = string.IsNullOrWhiteSpace(input.SharedNote) ? null : encrypt(current.Id, "event-shared", input.SharedNote),
                PrivateNoteCiphertext = string.IsNullOrWhiteSpace(input.PrivateNote) ? null : encrypt(current.Id, "event-private", input.PrivateNote) };
            if (input.Method == "Settle")
            {
                next = SettleParticipation(data, next, input.SettlementAmount, actor, now);
                next = next with { CreditProposals = FinancialProposals.Resolve(next.CreditProposals ?? [], null, actor, now, "Applied", input.SettlementAmount ?? next.FinalAmount) };
            }
            if (input.Method is "Pack" or "NoCharge") next = next with { CreditProposals = FinancialProposals.Resolve(next.CreditProposals ?? [], null, actor, now, "NotUsed") };
        }
        else if (input.Action == "DefineParticipationContribution")
        {
            Manager(actor);
            Require(ev.Service.ServiceKind == "Group" && GroupPaymentConditions.Mode(ev) == "Contribution" && current.Attendance == "Performed"
                && ClientAgenda.UndefinedDebt(current) && Money(input.Amount), "A contribuição só pode ser definida uma vez, com valor positivo.", 409);
            next = current with { FinalAmount = input.Amount };
        }
        else if (input.Action == "SettleParticipation")
        {
            Manager(actor);
            Require(!IsFree(ev.Service), "A participação neste grupo é gratuita e não tem valor a liquidar.");
            var resolved = FinancialProposals.Resolve(current.CreditProposals ?? [], input.RelatedId, actor, now, "Applied", input.Amount ?? AmountDue(data, current));
            if (ev.Service.ServiceKind == "Retreat") next = RetreatFinance.Settle(data, current, input, actor, now);
            else next = SettleParticipation(data, current, input.Amount, actor, now);
            next = next with { CreditProposals = resolved };
        }
        else if (input.Action == "UseParticipationCreditForAdvance")
        {
            Manager(actor);
            Require(ev.Service.ServiceKind == "Group" && current.State == "Confirmed" && current.ExpectationOpen && current.AdvanceSatisfiedAt is null && current.PersonId is not null
                && Money(ev.Service.ReferencePrice) && data.Balance(current.PersonId) >= ev.Service.ReferencePrice, "Não existe crédito suficiente ou antecipação por satisfazer.", 409);
            next = current with { ExpectationOpen = false, AdvanceSatisfiedAt = now, AdvanceSatisfiedBalance = data.Balance(current.PersonId!),
                CreditProposals = FinancialProposals.Resolve(current.CreditProposals ?? [], null, actor, now, "AdvanceAccepted") };
        }
        else if (input.Action == "ProposeParticipationCredit")
        {
            Require(!actor.IsManager && current.PersonId == actor.PersonId && current.Attendance == "Performed" && ev.Service.ServiceKind == "Group" && AmountDue(data, current) > 0, "Só podes propor crédito para uma participação realizada com dívida.", 409);
            next = current with { CreditProposals = FinancialProposals.Create(current.CreditProposals ?? [], input, actor, now, data.Balance(current.PersonId!), AmountDue(data, current)) };
            data.EventNotices.Add(new(Guid.NewGuid().ToString(), ev.Id, current.Id, null, "CreditProposal:" + input.OperationId, ev.ScheduleVersion, now, null));
        }
        else if (input.Action == "DeclineParticipationCredit")
        {
            Manager(actor);
            next = current with { CreditProposals = FinancialProposals.Resolve(current.CreditProposals ?? [], input.RelatedId, actor, now, "Declined") };
        }
        else if (input.Action == "ArchiveParticipation")
        {
            Require(!actor.IsManager && ClientAgenda.CanArchive(data, ev, current, now), "Só podes arquivar uma participação terminada sem pendência financeira.", 409);
            Require(input.PublicContentVersion == current.PublicContentVersion, "A informação partilhada mudou. Consulta a versão atual antes de a marcar como vista.", 409);
            next = current with { ArchivedAt = now, ArchivedBy = actor.AccountId, ArchivedContentVersion = current.PublicContentVersion,
                ReadHistory = (current.ReadHistory ?? []).Any(r => r.AccountId == actor.AccountId && r.PublicContentVersion == current.PublicContentVersion)
                    ? current.ReadHistory : [..current.ReadHistory ?? [], new(actor.AccountId, current.PublicContentVersion, now)] };
        }
        else if (input.Action is "DecideRetreatReturn" or "ReturnRetreatPayment") next = RetreatFinance.Return(data, ev, current, input, actor, now, encrypt);
        else throw new IdentityProblem(400, "Ação de evento inválida.");
        data.Participations[pi] = next with { Version = current.Version + 1,
            ExpectationOpen = next.ExpectationOpen && next.State == "Confirmed" && next.Attendance is null,
            History = [..current.History ?? [], new(input.Action, actor.AccountId, now,
            input.Amount, input.Action == "DecideRetreatReturn" ? next.ReturnReasonCiphertext : null)] };
        if (input.Action != "ArchiveParticipation") Touch(data, ev);
        return new(current.Id, "Inscrição atualizada.");
    }
    private static EventParticipation SettleParticipation(ConsultationData data, EventParticipation p, decimal? requested, ConsultationActor actor, DateTimeOffset now)
    {
        Manager(actor);
        var remaining = AmountDue(data, p); var amount = requested ?? remaining;
        Require(p.State == "Confirmed" && p.Attendance == "Performed" && p.PersonId is not null && p.FinancialChoice == "Unpaid" && p.SettlementId is null && remaining > 0, "A liquidação exige uma participação realizada com dívida monetária.", 409);
        Require(Money(amount) && amount <= remaining, "Indica um valor positivo até à dívida existente.", 409);
        var allocations = CreditLedger.Allocate(data, p.PersonId!, amount); var id = Guid.NewGuid().ToString();
        data.Entries.Add(new(id, p.PersonId!, null, "Settlement", -amount, actor.AccountId, now, null, "Credit", null, Origin: "EventService", OriginReference: p.Id, Allocations: allocations, Sequence: CreditLedger.NextSequence(data)));
        return p with { SettledAmount = p.SettledAmount + amount, SettlementId = amount == remaining ? id : null };
    }
    private static void Touch(ConsultationData data, GroupEvent item) => data.Events[data.Events.FindIndex(e => e.Id == item.Id)] = item with { Version = item.Version + 1 };
    public static void Advance(ConsultationData data, DateTimeOffset now)
    {
        GroupPaymentConditions.SatisfyAdvances(data, now);
        foreach (var p in data.Participations)
        {
            var ev = data.Events.Single(e => e.Id == p.EventId); var start = ev.Definition.StartsAt;
            var usesPortal = p.GuestOperationId is null || p.PersonId is not null && data.ClientAccountPeople.Contains(p.PersonId);
            if (p.State == "Requested" && now < start && ev.State == "Scheduled") Add("EventGuestRequest", p.CreatedAt, start, null);
            if (usesPortal && p.State == "Confirmed" && ev.State == "Scheduled" && p.ConfirmedAt is { } confirmed)
            {
                if (p.History?.Any(h => h.Action == "ScheduleChanged") == true) Add("EventChanged", confirmed, start, p.PersonId);
                else if (!data.EventNotices.Any(n => n.ParticipationId == p.Id && n.Kind == "EventAcceptanceSummary")) Add("EventConfirmed", confirmed, start, p.PersonId);
                var lead = start - confirmed;
                if (lead >= TimeSpan.FromHours(36)) Add("EventReminder24", start.AddHours(-24), start, p.PersonId);
                if (lead >= TimeSpan.FromHours(3)) Add("EventReminder1", start.AddHours(-1), start, p.PersonId);
            }
            if (ev.State == "Cancelled" && p.PersonId is not null && usesPortal) Add("EventCancelled", ev.History?.LastOrDefault()?.At ?? now, null, p.PersonId);
            if (p.State == "Confirmed" && p.ExpectationOpen && p.AcceptedAt is { } accepted)
                foreach (var hours in new[] { 8, 12 }) foreach (var person in new string?[] { p.PersonId, null })
                    Add("EventWait" + hours, accepted.AddHours(hours), null, person);
            void Add(string kind, DateTimeOffset due, DateTimeOffset? expires, string? person)
            {
                // A contact-only request is a management task, never an anonymous client notification.
                if (person is null && kind is not ("EventGuestRequest" or "EventWait8" or "EventWait12")) return;
                if (!data.EventNotices.Any(n => n.ParticipationId == p.Id && n.Kind == kind && n.PersonId == person && n.ScheduleVersion == ev.ScheduleVersion))
                    data.EventNotices.Add(new(Guid.NewGuid().ToString(), ev.Id, p.Id, person, kind, ev.ScheduleVersion, due, expires,
                        PushState: "Pending", EmailPending: kind == "EventConfirmed" && IsFree(ev.Service)));
            }
        }
        for (var i = 0; i < data.EventNotices.Count; i++)
        {
            var notice = data.EventNotices[i]; var ev = data.Events.Single(e => e.Id == notice.EventId); var p = data.Participations.Single(p => p.Id == notice.ParticipationId);
            if (!notice.Cancelled && (notice.ExpiresAt <= now || notice.ScheduleVersion != ev.ScheduleVersion || notice.Kind is "EventWait8" or "EventWait12" && !p.ExpectationOpen || notice.Kind == "EventGuestRequest" && (p.State != "Requested" || ev.State != "Scheduled")
                || notice.Kind.StartsWith("CreditProposal:", StringComparison.Ordinal) && !(p.CreditProposals ?? []).Any(proposal => notice.Kind == "CreditProposal:" + proposal.Id && proposal.Decision is null)
                || notice.Kind is "EventReminder24" or "EventReminder1" or "EventConfirmed" or "EventChanged" && (p.State != "Confirmed" || ev.State != "Scheduled")))
                data.EventNotices[i] = notice with { Cancelled = true };
        }
    }
}
