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
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? BillingMode = null, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? MinimumParticipants = null, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool AllowClientCredit = false);
public sealed record RetreatReturn(string Id, decimal Amount, string Method, DateTimeOffset EffectiveAt, string AuthorId, DateTimeOffset CreatedAt, string EntryId);
public sealed record EventRevision(string AuthorId, DateTimeOffset At, string Action, EventInput Before, EventInput After);
public sealed record EventBlockOverride(string WindowId, long WindowVersion, string AuthorId, DateTimeOffset At, DateTimeOffset StartsAt, DateTimeOffset EndsAt);
public sealed record GroupEvent(string Id, ConsultationService Service, EventInput Definition, string CreatedBy, DateTimeOffset CreatedAt,
    long Version = 1, string State = "Waiting", long ScheduleVersion = 1, bool KeepBlocked = false,
    DateTimeOffset? ActualStartsAt = null, DateTimeOffset? ActualEndsAt = null, EventRevision[]? History = null, EventBlockOverride[]? Overrides = null,
    ProcessStageChange[]? StageHistory = null, string? CancellationReason = null);
public sealed record ParticipationDecision(string Action, string AuthorId, DateTimeOffset At, decimal? Amount = null, string? ReasonCiphertext = null);
public sealed record EventParticipation(string Id, string EventId, string? PersonId, string State, DateTimeOffset CreatedAt,
    long Version = 1, DateTimeOffset? ConfirmedAt = null, long ConfirmedScheduleVersion = 1,
    string? Attendance = null, string? FinancialChoice = null, decimal? FinalAmount = null, string? SettlementId = null,
    string? SharedSummaryCiphertext = null, string? PrivateNoteCiphertext = null, string? GuestContactCiphertext = null,
    ParticipationDecision[]? History = null, string? GuestOperationId = null, string? GuestRequestHash = null,
    decimal? AgreedTotal = null, decimal? ReturnDue = null, RetreatReturn[]? Returns = null, string? CancellationBy = null, string? ReturnReasonCiphertext = null,
    DateTimeOffset? ArchivedAt = null, string? ArchivedBy = null, long PublicContentVersion = 1, long? ArchivedContentVersion = null,
    ConsultationRead[]? ReadHistory = null, ProcessStageChange[]? StageHistory = null,
    DateTimeOffset? AcceptedAt = null, string? AcceptedTermsVersion = null, string? AcceptedBy = null,
    bool ExpectationOpen = false, DateTimeOffset? AdvanceSatisfiedAt = null,
    ConsultationConditionSet? AcceptedConditions = null, decimal SettledAmount = 0, CreditUseProposal[]? CreditProposals = null, decimal? AdvanceSatisfiedBalance = null,
    bool RequiresClientAcceptance = false, ConsultationCreditAuthorization[]? CreditAuthorizations = null,
    DateTimeOffset? PaymentDeclaredAt = null, long ConversationVersion = 1, bool ConversationBlocked = false,
    ConversationDecision[]? ConversationHistory = null, string[]? PhotoIds = null, DateTimeOffset? ClosedAt = null);
public sealed record EventCashEntry(string Id, string EventId, string ParticipationId, decimal Amount, string Method, DateTimeOffset EffectiveAt, string AuthorId, DateTimeOffset CreatedAt);
public sealed record EventNotice(string Id, string EventId, string? ParticipationId, string? PersonId, string Kind, long ScheduleVersion,
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
    public static decimal AmountDue(ConsultationData data, EventParticipation p) => ParticipationCredit.Remaining(data, data.Events.Single(e => e.Id == p.EventId), p);
    public static int Seats(ConsultationData data, string eventId) => data.Participations.Count(p => p.EventId == eventId && p.State is "Confirmed" or "Requested");
    public static bool Eligible(GroupEvent item, string person) => true;
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
        var item = data.Events.SingleOrDefault(e => e.Id == eventId && e.Definition.Published && e.State == "Waiting") ?? throw new IdentityProblem(404, "Evento não encontrado.");
        Require(EventLifecycle.RegistrationOpen(item, now) && item.Service.Id == input.ServiceId && item.Definition.StartsAt == input.StartsAt, "O evento mudou ou já começou.", 409);
        AgendaRules.ValidateGoogleAvailability(data, item.Definition.StartsAt, item.Definition.EndsAt);
        var waiting = Seats(data, item.Id) >= item.Definition.Capacity;
        var requestAcceptance = !IsFree(item.Service);
        if (requestAcceptance) GroupPaymentConditions.ValidateAcceptance(item, input.ConditionsAccepted, input.TermsVersion);
        var id = Guid.NewGuid().ToString();
        data.Participations.Add(new(id, eventId, Guid.NewGuid().ToString(), waiting ? "Waiting" : "Requested", now, GuestContactCiphertext: encrypt(id, "event-contact", JsonSerializer.Serialize(new GuestContact(input.FirstName, input.LastName, input.DialCode, input.Phone, input.Email, input.Locality))), GuestOperationId: input.OperationId, GuestRequestHash: hash,
            AcceptedAt: requestAcceptance ? now : null, AcceptedTermsVersion: requestAcceptance ? input.TermsVersion : null,
            AcceptedConditions: requestAcceptance ? GroupPaymentConditions.Describe(item, data.PublishedSite) : null));
        Touch(data, item); return new(id, waiting ? "Pedido recebido na fila de desistências. Aguarda o contacto da terapeuta." : "Pedido recebido. Aguarda o contacto da terapeuta.");
    }
    public static ConsultationResult Apply(ConsultationData data, ConsultationCommand input, ConsultationActor actor, DateTimeOffset now, Func<string, string, string, string> encrypt)
    {
        if (input.Action == "SaveEvent")
        {
            Manager(actor); var definition = input.Event ?? throw new IdentityProblem(400, "Preenche o evento.");
            var existing = input.Id is null ? null : data.Events.SingleOrDefault(e => e.Id == input.Id) ?? throw new IdentityProblem(404, "Evento não encontrado.");
            Require(existing is null || existing.Version == input.Version && existing.State is "Waiting" or "AwaitingClosure", "O evento mudou ou já foi encerrado.", 409);
            var service = existing?.Service ?? ActivityCatalogue.Complete(data.Services).SingleOrDefault(s => s.Id == definition.ServiceId && s.Active && s.ServiceKind is "Group" or "Retreat") ?? throw new IdentityProblem(400, "Seleciona um serviço de grupo ou retiro.");
            Require(definition.ServiceId == service.Id, "Não alteres o serviço de um evento existente.");
            SharingWorkshop.ValidateService(service);
            GroupPaymentConditions.ValidateDefinition(definition, service, existing, data);
            Require((definition.PromotionText?.Length ?? 0) <= 2000, "O texto de divulgação pode ter até 2000 caracteres.");
            Require(!definition.Promoted || input.ConditionsAccepted, "Confirma expressamente a publicação da divulgação revista.");
            if (service.ServiceKind == "Retreat") RetreatFinance.ValidateDefinition(definition, service);
            Require(definition.EndsAt > definition.StartsAt, "O fim do evento deve ser posterior ao início. Corrige a data e a hora de fim.");
            Require(definition.StartsAt > now && AgendaRules.IsBookableStart(definition.StartsAt, now), "Indica um início futuro dentro do horizonte da agenda.");
            Require(definition.Capacity is >= 1 and <= 10000, "Indica uma lotação entre 1 e 10000.");
            Require(definition.MinimumParticipants is >= 1 && definition.MinimumParticipants <= definition.Capacity, "Indica o mínimo de participantes, até à lotação.");
            definition = definition with { StartsAt = definition.StartsAt.ToUniversalTime(), EndsAt = definition.EndsAt.ToUniversalTime(),
                PublicLocation = IdentityValidation.Required(definition.PublicLocation, 300, "o local do evento"), Published = true, AllowedPersonIds = null };
            Require(existing?.Definition.PublicLocation == definition.PublicLocation
                || PaCT.Api.Management.SiteLocations.PhysicalNames(data).Contains(definition.PublicLocation), "Escolhe um local ativo para o evento.");
            Require(service.PaymentMode != "Free" || definition.TotalPrice is null or 0, "A participação gratuita não tem preço nem contribuição.");
            if (service.ServiceKind == "Group")
            {
                Require(service.PaymentMode == "Free" || (definition.BillingMode ?? service.PaymentMode) == "Contribution" || Money(definition.TotalPrice), "Indica o preço por participante desta ocorrência.");
                var price = service.PaymentMode == "Free" ? 0 : (definition.BillingMode ?? service.PaymentMode) == "Contribution" ? (decimal?)null : definition.TotalPrice;
                Require(existing is null || !data.Participations.Any(p => p.EventId == existing.Id && p.State == "Confirmed")
                    || existing.Service.ReferencePrice == price, "O preço não pode mudar depois de existirem inscrições confirmadas.", 409);
                service = service with { ReferencePrice = price, PublicLocation = definition.PublicLocation };
            }
            AgendaRules.ValidateGoogleAvailability(data, definition.StartsAt, definition.EndsAt, manager: true);
            Require(AgendaRules.ConfirmedConflicts(data, definition.StartsAt, definition.EndsAt, now, existing?.Id).Length == 0,
                "Existe uma marcação ou evento com inscrições confirmadas. Resolve essa marcação antes de criar este evento.", 409);
            Require(existing is null || Seats(data, existing.Id) <= definition.Capacity || definition.Capacity >= existing.Definition.Capacity, "A lotação não pode ficar abaixo das vagas ocupadas ou provisórias.", 409);
            Require(existing is null || service.ServiceKind != "Retreat" || !data.Participations.Any(p => p.EventId == existing.Id && p.State == "Confirmed")
                || RetreatFinance.Price(existing) == (definition.TotalPrice ?? service.ReferencePrice), "O preço único não pode mudar depois de existirem inscrições confirmadas.", 409);
            service = existing is not null && existing.Definition.PublicLocation == definition.PublicLocation
                ? service with { Instructions = existing.Service.Instructions }
                : PaCT.Api.Management.SitePresentation.WithAddress(data.PublishedSite, service, definition.PublicLocation);
            var item = existing is null ? new(Guid.NewGuid().ToString(), service, definition, actor.AccountId, now) : existing with { Service = service, Definition = definition, Version = existing.Version + 1,
                State = "Waiting",
                ScheduleVersion = existing.ScheduleVersion + (existing.Definition.StartsAt != definition.StartsAt || existing.Definition.EndsAt != definition.EndsAt || existing.Definition.PublicLocation != definition.PublicLocation ? 1 : 0),
                History = [..existing.History ?? [], new(actor.AccountId, now, "Edit", existing.Definition, definition)] };
            AgendaRules.ReplaceUnconfirmed(data, definition.StartsAt, definition.EndsAt, actor, now, encrypt, existing?.Id);
            AgendaRules.RetireWindows(data, definition.StartsAt, definition.EndsAt, actor, now);
            if (!data.Services.Any(s => s.Id == service.Id) && ActivityCatalogue.IsBuiltIn(service.Id))
                data.Services.Add(ActivityCatalogue.Types().Single(type => type.Id == service.Id));
            if (existing is null) data.Events.Add(item); else data.Events[data.Events.FindIndex(e => e.Id == item.Id)] = item;
            if (existing is not null && existing.ScheduleVersion != item.ScheduleVersion)
                for (var i = 0; i < data.Participations.Count; i++)
                {
                    var p = data.Participations[i];
                    if (p.EventId == item.Id && p.State == "Confirmed") data.Participations[i] = p with { ConfirmedAt = now, ConfirmedScheduleVersion = item.ScheduleVersion,
                        Version = p.Version + 1, History = [..p.History ?? [], new("ScheduleChanged", actor.AccountId, now)] };
                }
            return new(item.Id, "Evento guardado.");
        }
        if (input.Action is "CancelEvent" or "PerformEvent")
        {
            Manager(actor); var index = data.Events.FindIndex(e => e.Id == input.Id); Require(index >= 0, "Evento não encontrado.", 404); var item = ProcessLifecycle.At(data.Events[index], now);
            Require(item.Version == input.Version && item.State is "Waiting" or "AwaitingClosure", "O evento mudou ou já foi encerrado.", 409);
            if (input.Action == "CancelEvent")
            {
                Require(input.AvailabilityChoice is "Release" or "Keep", "Escolhe o destino do horário.");
                data.Events[index] = item with { State = "Cancelled", CancellationReason = input.Choice == "MinimumParticipants" ? "MinimumParticipants" : "Organizer", KeepBlocked = input.AvailabilityChoice == "Keep", Version = item.Version + 1, ScheduleVersion = item.ScheduleVersion + 1,
                    History = [..item.History ?? [], new(actor.AccountId, now, "Cancel", item.Definition, item.Definition)] };
                for (var i = 0; i < data.Participations.Count; i++)
                {
                    var p = ProcessLifecycle.At(item, data.Participations[i], now);
                    if (p.EventId != item.Id || p.State is "Rejected" or "Expired") continue;
                    if (p.State == "Cancelled")
                    {
                        data.Participations[i] = p with { Version = p.Version + 1,
                            History = [..p.History ?? [], new("EventCancelledAfterWithdrawal", actor.AccountId, now)] };
                        continue;
                    }
                    data.Participations[i] = ParticipationCredit.Reconcile(data, p, 0, actor, now) with { State = "Cancelled", CancellationBy = input.Choice == "MinimumParticipants" ? "MinimumParticipants" : "Organizer", ExpectationOpen = false,
                        CreditProposals = FinancialProposals.End(p.CreditProposals ?? [], actor.AccountId, now),
                        ReturnDue = p.ReturnDue,
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
            Require(item.Version == input.Version && (item.State == "Waiting" && item.Definition.StartsAt > now || actor.IsManager && item.State == "Performed"), "O evento mudou ou já não permite inscrições.", 409);
            Require(actor.IsManager || EventLifecycle.RegistrationOpen(item, now), "O evento não está publicado.", 409);
            if (item.State == "Waiting") AgendaRules.ValidateGoogleAvailability(data, item.Definition.StartsAt, item.Definition.EndsAt, actor.IsManager);
            var person = actor.IsManager ? input.PersonId : actor.PersonId;
            Require(Guid.TryParse(person, out _) || actor.IsManager && input.Choice == "Anonymous", "Seleciona a ficha do participante.");
            Require(item.Service.ServiceKind != "Retreat" || person is not null, "A inscrição num retiro exige uma ficha, mesmo sem conta.");
            Require(input.Choice != "Anonymous" || actor.IsManager && person is null && item.State == "Performed" && input.Method is "NoCharge" or "AnonymousPaid", "A participação anónima exige realização registada e fecho sem dívida ou com pagamento integral confirmado.");
            if (input.Choice == "Anonymous") ValidateFreeParticipation(item.Service, input);
            Require(actor.IsManager || Eligible(item, person!), "Esta inscrição exige autorização da terapeuta.", 403);
            Require(person is null || !data.Participations.Any(p => p.EventId == item.Id && p.PersonId == person && p.State is "Confirmed" or "Waiting" or "Requested"), "Esta pessoa já tem uma inscrição ativa.", 409);
            var waiting = input.Choice == "Waiting";
            Require(actor.IsManager || !waiting || Seats(data, item.Id) >= item.Definition.Capacity, "Ainda existem vagas; confirma a inscrição normal.", 409);
            var financialAcceptance = !actor.IsManager && !IsFree(item.Service);
            if (financialAcceptance) GroupPaymentConditions.ValidateAcceptance(item, input);
            Require(actor.IsManager || input.Amount is null || financialAcceptance && GroupPaymentConditions.Mode(item) == "Prepayment", "A proposta de crédito exige uma inscrição com pré-pagamento.");
            Require(waiting || Seats(data, item.Id) < item.Definition.Capacity || actor.IsManager && input.ConfirmOvercapacity, "A lotação foi atingida. Confirma expressamente a inscrição acima do limite.", 409);
            var p = new EventParticipation(Guid.NewGuid().ToString(), item.Id, person, waiting ? "Waiting" : "Confirmed", now,
                ConfirmedAt: waiting ? null : now, ConfirmedScheduleVersion: item.ScheduleVersion, History: [new("Join", actor.AccountId, now)],
                AgreedTotal: !waiting && GroupPaymentConditions.Mode(item) == "Prepayment" ? item.Definition.TotalPrice ?? item.Service.ReferencePrice : null,
                FinancialChoice: !waiting && GroupPaymentConditions.Mode(item) == "Prepayment" ? "Unpaid" : null,
                FinalAmount: !waiting && item.Service.ServiceKind == "Retreat" ? RetreatFinance.Price(item) : null,
                AcceptedAt: financialAcceptance ? now : null, AcceptedBy: financialAcceptance ? actor.AccountId : null,
                AcceptedTermsVersion: financialAcceptance ? GroupPaymentConditions.Describe(item).Version : null,
                AcceptedConditions: financialAcceptance ? GroupPaymentConditions.Describe(item, data.PublishedSite) : null,
                RequiresClientAcceptance: !IsFree(item.Service) && person is not null && ConsultationConditions.HasClientAccount(data, person),
                ExpectationOpen: !waiting && GroupPaymentConditions.Mode(item) == "Prepayment" && !IsFree(item.Service));
            if (!waiting) p = ParticipationCredit.Authorize(data, item, p, item.CreatedBy, now);
            data.Participations.Add(p); Touch(data, item);
            if (financialAcceptance && !waiting) GroupPaymentConditions.AcceptanceNotice(data, item, p, now);
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
            Manager(actor); Require(current.State == "Requested" && ev.State == "Waiting" && now < ev.Definition.StartsAt, "Este pedido já foi tratado ou expirou.", 409);
            AgendaRules.ValidateGoogleAvailability(data, ev.Definition.StartsAt, ev.Definition.EndsAt, manager: true);
            Require(Guid.TryParse(input.PersonId, out _) && input.ConditionsAccepted, "Seleciona a ficha e confirma que verificaste a identidade.");
            Require(!data.Participations.Any(p => p.EventId == ev.Id && p.PersonId == input.PersonId && p.State is "Confirmed" or "Waiting"), "Esta pessoa já tem uma inscrição ativa.", 409);
            Require(Seats(data, ev.Id) <= ev.Definition.Capacity, "Revê a lotação antes de confirmar.", 409);
            Require(current.AcceptedAt is null || current.AcceptedTermsVersion == GroupPaymentConditions.Describe(ev).Version,
                "As condições do evento mudaram depois da aceitação. O cliente precisa de fazer um novo pedido com as condições atuais.", 409);
            next = current with { PersonId = input.PersonId, State = "Confirmed", ConfirmedAt = now, ConfirmedScheduleVersion = ev.ScheduleVersion,
                AgreedTotal = GroupPaymentConditions.Mode(ev) == "Prepayment" ? ev.Definition.TotalPrice ?? ev.Service.ReferencePrice : null,
                FinancialChoice = GroupPaymentConditions.Mode(ev) == "Prepayment" ? "Unpaid" : null,
                FinalAmount = ev.Service.ServiceKind == "Retreat" ? RetreatFinance.Price(ev) : null,
                ExpectationOpen = GroupPaymentConditions.Mode(ev) == "Prepayment" && !IsFree(ev.Service),
                RequiresClientAcceptance = !IsFree(ev.Service) && ConsultationConditions.HasClientAccount(data, input.PersonId!) };
        }
        else if (input.Action == "AcceptParticipationConditions")
        {
            Require(!actor.IsManager && actor.PersonId == current.PersonId, "A aceitação destas condições pertence ao cliente da inscrição.", 403);
            Require(GroupPaymentConditions.Pending(ev, current, now), "Não existem condições desta inscrição por aceitar.", 409);
            GroupPaymentConditions.ValidateAcceptance(ev, input);
            next = current with { AcceptedAt = now, AcceptedBy = actor.AccountId, AcceptedTermsVersion = GroupPaymentConditions.Describe(ev).Version,
                AcceptedConditions = GroupPaymentConditions.Describe(ev, data.PublishedSite) };
            GroupPaymentConditions.AcceptanceNotice(data, ev, next, now);
        }
        else if (input.Action == "RejectEventGuest")
        { Manager(actor); Require(current.State == "Requested", "Este pedido já foi tratado.", 409); next = current with { State = "Rejected", CancellationBy = "Rejected" }; }
        else if (input.Action == "CancelParticipation")
        {
            Require(current.State is "Confirmed" or "Waiting" && current.Attendance is null, "Esta inscrição já não permite cancelamento.", 409);
            Require(ev.State == "Waiting" && now < ev.Definition.StartsAt, "A sessão já começou ou foi encerrada. Contacta a terapeuta.", 409);
            next = ParticipationCredit.Reconcile(data, current, 0, actor, now) with { State = "Cancelled",
                CancellationBy = actor.IsManager ? "Organizer" : "Participant", ExpectationOpen = false,
                CreditProposals = FinancialProposals.End(current.CreditProposals ?? [], actor.AccountId, now) };
            data.EventNotices.Add(new(Guid.NewGuid().ToString(), ev.Id, current.Id, null, "EventParticipantCancelled", ev.ScheduleVersion, now, null, PushState: "Pending"));
            if (current.PersonId is not null && ConsultationConditions.HasClientAccount(data, current.PersonId))
                data.EventNotices.Add(new(Guid.NewGuid().ToString(), ev.Id, current.Id, current.PersonId, "EventCancelled", ev.ScheduleVersion, now, null, PushState: "Pending", EmailPending: true));
        }
        else if (input.Action is "ConfirmParticipation" or "RegisterParticipation")
        {
            Manager(actor);
            var actual = input.Action == "RegisterParticipation";
            Require(ev.State != "Cancelled" && current.Attendance is null && (actual
                ? now >= ev.Definition.StartsAt && current.State == "Expired"
                : ev.State == "Waiting" && now < ev.Definition.StartsAt && current.State == "Waiting"), "Este pedido já não permite esta confirmação.", 409);
            if (!actual) AgendaRules.ValidateGoogleAvailability(data, ev.Definition.StartsAt, ev.Definition.EndsAt, manager: true);
            if (!actual) Require(data.Participations.Where(p => p.EventId == ev.Id && p.State == "Waiting").OrderBy(p => p.CreatedAt).ThenBy(p => p.Id, StringComparer.Ordinal).First().Id == current.Id,
                "Confirma primeiro o pedido mais antigo da fila de desistências.", 409);
            Require(Seats(data, ev.Id) < ev.Definition.Capacity || input.ConfirmOvercapacity, "A lotação foi atingida. Confirma expressamente a inscrição acima do limite.", 409);
            Require(current.AcceptedAt is null || current.AcceptedTermsVersion == GroupPaymentConditions.Describe(ev).Version,
                "As condições mudaram; o titular precisa de aceitar a versão atual antes da inscrição.", 409);
            next = current with { State = "Confirmed", ConfirmedAt = now, ConfirmedScheduleVersion = ev.ScheduleVersion,
                AgreedTotal = GroupPaymentConditions.Mode(ev) == "Prepayment" ? ev.Definition.TotalPrice ?? ev.Service.ReferencePrice : null,
                FinancialChoice = GroupPaymentConditions.Mode(ev) == "Prepayment" ? "Unpaid" : null,
                FinalAmount = ev.Service.ServiceKind == "Retreat" ? RetreatFinance.Price(ev) : null,
                ExpectationOpen = !actual && !IsFree(ev.Service) && GroupPaymentConditions.Mode(ev) == "Prepayment",
                ArchivedAt = null, ArchivedBy = null, ArchivedContentVersion = null, PublicContentVersion = actual ? current.PublicContentVersion + 1 : current.PublicContentVersion };
        }
        else if (input.Action == "CloseParticipation")
        {
            Manager(actor); Require(now >= ev.Definition.StartsAt && current.State is "Confirmed" or "Cancelled" && current.Attendance is null, "A presença só pode ser fechada uma vez após o início do evento.", 409);
            Require(input.Choice is "Performed" or "NoShow" || ev.Service.ServiceKind == "Retreat" && input.Choice == "Withdrawn", "Escolhe presença, falta ou desistência durante o retiro.");
            ValidateFreeParticipation(ev.Service, input);
            Require(ev.Service.ServiceKind != "Retreat" || input.Method != "Pack", "Retiros não podem utilizar sessões de pack.");
            Require(ev.Service.ServiceKind == "Retreat" || input.Choice != "NoShow" || input.Method == "NoCharge", "A falta a uma consulta de grupo fica sem dívida e não consome saldo ou pack.");
            Require(ev.State != "Cancelled" && current.State != "Cancelled" || input.Method == "NoCharge", "O evento cancelado permite registar presença, sem criar cobrança.");
            Require(input.Method is "Unpaid" or "Settle" or "Undefined" or "NoCharge" or "Pack" or "AnonymousPaid", "Escolhe o tratamento financeiro.");
            Require(input.Method != "Undefined" || ev.Service.ServiceKind == "Group" && GroupPaymentConditions.Mode(ev) == "Contribution" && input.Choice == "Performed" && current.PersonId is not null && input.Amount is null, "Só a contribuição livre de uma participação realizada com ficha pode ficar por definir.");
            Require(input.SettlementAmount is null || input.Method == "Settle" && (input.Choice == "Performed" || ev.Service.ServiceKind == "Retreat"), "A utilização de crédito exige uma decisão de liquidação monetária no fecho.");
            Require(input.Method != "Settle" || (input.Choice == "Performed" || ev.Service.ServiceKind == "Retreat") && current.PersonId is not null, "Só a participação realizada com ficha pode ser liquidada no fecho.");
            Require(input.Method != "Pack" || input.Choice == "Performed", "Uma falta nunca consome sessões de pack.");
            Require(input.Method is "NoCharge" or "Pack" or "Undefined" || Money(input.Amount), "Indica um valor positivo.");
            Require(current.PersonId is not null || input.Method is "NoCharge" or "AnonymousPaid", "Uma participação sem ficha não pode ter dívida nem usar crédito ou pack.");
            Require(input.Method != "AnonymousPaid" || current.PersonId is null && input.Method2 is "Cash" or "Transfer" or "MbWay" or "Card" or "Other", "Regista o meio do recebimento integral anónimo.");
            Require((input.SharedNote?.Length ?? 0) <= 8000 && (input.PrivateNote?.Length ?? 0) <= 8000, "As notas podem ter até 8000 caracteres.");
            Require(input.Choice == "Performed" || string.IsNullOrWhiteSpace(input.SharedNote), "A partilha de acompanhamento exige presença.");
            if (input.Method == "Pack") SessionPacks.Consume(data, input.PackId ?? "", current.PersonId!, current.Id, ev.Service.Id, "EventParticipation", ev.ActualStartsAt ?? ev.Definition.StartsAt, actor, now);
            if (input.Method == "AnonymousPaid")
            {
                Require(input.StartsAt > DateTimeOffset.UnixEpoch && input.StartsAt <= now, "Indica a data do recebimento efetivo.");
                data.EventCash.Add(new(Guid.NewGuid().ToString(), ev.Id, current.Id, input.Amount!.Value, input.Method2!, input.StartsAt, actor.AccountId, now));
            }
            next = current with { Attendance = input.Choice, FinancialChoice = input.Method is "Settle" or "Undefined" ? "Unpaid" : input.Method,
                FinalAmount = input.Method is "NoCharge" or "Pack" ? 0 : input.Amount, ClosedAt = now, PhotoIds = input.PhotoIds,
                SharedSummaryCiphertext = string.IsNullOrWhiteSpace(input.SharedNote) ? null : encrypt(current.Id, "event-shared", input.SharedNote),
                PrivateNoteCiphertext = string.IsNullOrWhiteSpace(input.PrivateNote) ? null : encrypt(current.Id, "event-private", input.PrivateNote) };
            next = ParticipationCredit.Reconcile(data, next, next.FinalAmount ?? 0, actor, now);
            if (input.Method == "Settle" && AmountDue(data, next) > 0)
            {
                next = ParticipationCredit.Settle(data, ev, next, input.SettlementAmount, actor, now);
                next = next with { CreditProposals = FinancialProposals.Resolve(next.CreditProposals ?? [], null, actor, now, "Applied", input.SettlementAmount ?? next.FinalAmount) };
            }
            if (input.Method is "Pack" or "NoCharge") next = next with { CreditProposals = FinancialProposals.Resolve(next.CreditProposals ?? [], null, actor, now, "NotUsed") };
        }
        else if (input.Action is "SettleParticipation" or "UseParticipationCredit")
        {
            if (input.Action == "SettleParticipation") Manager(actor);
            else Require(!actor.IsManager && actor.PersonId == current.PersonId, "Esta opção pertence ao titular da inscrição.", 403);
            next = ParticipationCredit.Settle(data, ev, current, input.Amount, actor, now);
        }
        else if (input.Action == "DeclareParticipationPayment")
        {
            Require(!actor.IsManager && actor.PersonId == current.PersonId && ParticipationCredit.Payable(ev, current)
                && current.PaymentDeclaredAt is null, "Não existe pagamento desta inscrição por comunicar.", 409);
            next = current with { PaymentDeclaredAt = now };
            data.EventNotices.Add(new(Guid.NewGuid().ToString(), ev.Id, current.Id, null, "EventPaymentDeclared", ev.ScheduleVersion, now, null, PushState: "Pending"));
        }
        else if (input.Action == "ArchiveParticipation")
        {
            Require(!actor.IsManager && ClientAgenda.CanArchive(data, ev, current, now), "Só podes arquivar uma participação terminada sem pendência financeira.", 409);
            Require(input.PublicContentVersion == current.PublicContentVersion, "A informação partilhada mudou. Consulta a versão atual antes de a marcar como vista.", 409);
            if (current.Attendance == "Performed" && input.MessageIds is { Length: > 0 })
                ConsultationConversation.MarkPresented(data, ConsultationConversation.Authorized(data, current.Id, actor), input.MessageIds, actor, now, 1000);
            next = current with { ArchivedAt = now, ArchivedBy = actor.AccountId, ArchivedContentVersion = current.PublicContentVersion,
                ReadHistory = (current.ReadHistory ?? []).Any(r => r.AccountId == actor.AccountId && r.PublicContentVersion == current.PublicContentVersion)
                    ? current.ReadHistory : [..current.ReadHistory ?? [], new(actor.AccountId, current.PublicContentVersion, now)] };
        }
        else throw new IdentityProblem(400, "Ação de evento inválida.");
        if (input.Action is "LinkEventGuest" or "ConfirmParticipation" or "RegisterParticipation") next = ParticipationCredit.Authorize(data, ev, next with { RequiresClientAcceptance = !IsFree(ev.Service) && next.PersonId is not null && ConsultationConditions.HasClientAccount(data, next.PersonId) }, actor.AccountId, now);
        if (input.Action == "ConfirmParticipation" && next.AcceptedAt is not null) GroupPaymentConditions.AcceptanceNotice(data, ev, next, now);
        if (input.Action == "CloseParticipation")
            data.EventNotices.Add(new(Guid.NewGuid().ToString(), ev.Id, current.Id, current.PersonId, "EventParticipationClosed", ev.ScheduleVersion, now, null, PushState: "Pending", EmailPending: true));
        data.Participations[pi] = next with { Version = current.Version + 1,
            ExpectationOpen = next.ExpectationOpen && next.State == "Confirmed" && next.Attendance != "NoShow",
            History = [..current.History ?? [], new(input.Action, actor.AccountId, now,
            input.Amount)] };
        if (input.Action != "ArchiveParticipation") Touch(data, ev);
        return new(current.Id, "Inscrição atualizada.");
    }
    private static void Touch(ConsultationData data, GroupEvent item) => data.Events[data.Events.FindIndex(e => e.Id == item.Id)] = item with { Version = item.Version + 1 };
    public static void Advance(ConsultationData data, DateTimeOffset now)
    {
        for (var i = 0; i < data.Events.Count; i++) data.Events[i] = EventLifecycle.At(data.Events[i], now);
        var occurrences = data.Events.ToDictionary(e => e.Id);
        for (var i = 0; i < data.Participations.Count; i++) data.Participations[i] = EventLifecycle.At(occurrences[data.Participations[i].EventId], data.Participations[i], now);
        foreach (var item in data.Events.Where(e => e.State == "AwaitingClosure" && e.Definition.MinimumParticipants is not null))
            if (data.Participations.Count(p => p.EventId == item.Id && p.State == "Confirmed") < item.Definition.MinimumParticipants
                && !data.EventNotices.Any(n => n.EventId == item.Id && n.Kind == "EventMinimumParticipants" && n.ScheduleVersion == item.ScheduleVersion))
                data.EventNotices.Add(new(Guid.NewGuid().ToString(), item.Id, null, null, "EventMinimumParticipants", item.ScheduleVersion, item.Definition.StartsAt, null, PushState: "Pending"));
        foreach (var message in data.Messages.Where(m => m.ParticipationId is not null))
        {
            var readAt = data.MessageReads.Where(r => r.MessageId == message.Id).Select(r => (DateTimeOffset?)r.At).Min();
            if (readAt is not null)
                for (var index = 0; index < data.EventNotices.Count; index++)
                    if (data.EventNotices[index].Kind == "FollowupMessage:" + message.Id)
                        data.EventNotices[index] = data.EventNotices[index] with { ReadAt = data.EventNotices[index].ReadAt ?? readAt };
        }
        GroupPaymentConditions.SatisfyAdvances(data, now);
        foreach (var p in data.Participations)
        {
            var ev = data.Events.Single(e => e.Id == p.EventId); var start = ev.Definition.StartsAt;
            var usesPortal = p.PersonId is not null && ConsultationConditions.HasClientAccount(data, p.PersonId);
            if (p.State == "Expired" && usesPortal) Add("EventRegistrationExpired", start, null, p.PersonId);
            if (p.State == "Requested" && now < start && ev.State == "Waiting") Add("EventGuestRequest", p.CreatedAt, start, null);
            if (p.State == "Waiting" && ev.State == "Waiting" && Seats(data, ev.Id) < ev.Definition.Capacity
                && !data.EventNotices.Any(n => n.EventId == ev.Id && n.Kind == "EventWaitlistVacancy" && !n.Cancelled && n.ReadAt is null))
                data.EventNotices.Add(new(Guid.NewGuid().ToString(), ev.Id, null, null, "EventWaitlistVacancy", ev.ScheduleVersion, now, start, PushState: "Pending"));
            if (usesPortal && p.State == "Confirmed" && ev.State == "Waiting" && p.ConfirmedAt is { } confirmed)
            {
                if (p.History?.Any(h => h.Action == "ScheduleChanged") == true) Add("EventChanged", confirmed, start, p.PersonId);
                else if (!data.EventNotices.Any(n => n.ParticipationId == p.Id && n.Kind == "EventAcceptanceSummary")) Add("EventConfirmed", confirmed, start, p.PersonId);
                var lead = start - confirmed;
                if (lead >= TimeSpan.FromHours(36)) Add("EventReminder24", start.AddHours(-24), start, p.PersonId);
                if (lead >= TimeSpan.FromHours(3)) Add("EventReminder1", start.AddHours(-1), start, p.PersonId);
            }
            if (ev.State == "Cancelled" && p.PersonId is not null && usesPortal) Add("EventCancelled", ev.History?.LastOrDefault()?.At ?? now, null, p.PersonId);
            if (p.State == "Confirmed" && p.ExpectationOpen && p.AcceptedAt is { } accepted)
                foreach (var hours in new[] { 8, 12 }) foreach (var person in usesPortal ? new string?[] { p.PersonId, null } : new string?[] { null })
                    Add("EventWait" + hours, (p.ConfirmedAt > accepted ? p.ConfirmedAt.Value : accepted).AddHours(hours), null, person);
            void Add(string kind, DateTimeOffset due, DateTimeOffset? expires, string? person)
            {
                // A contact-only request is a management task, never an anonymous client notification.
                if (person is null && kind is not ("EventGuestRequest" or "EventWait8" or "EventWait12")) return;
                if (!data.EventNotices.Any(n => n.ParticipationId == p.Id && n.Kind == kind && n.PersonId == person && n.ScheduleVersion == ev.ScheduleVersion))
                    data.EventNotices.Add(new(Guid.NewGuid().ToString(), ev.Id, p.Id, person, kind, ev.ScheduleVersion, due, expires,
                        PushState: "Pending", EmailPending: kind == "EventConfirmed" && IsFree(ev.Service) || kind is "EventCancelled" or "EventReminder24"));
            }
        }
        for (var i = 0; i < data.EventNotices.Count; i++)
        {
            var notice = data.EventNotices[i]; var ev = data.Events.Single(e => e.Id == notice.EventId); var p = data.Participations.SingleOrDefault(p => p.Id == notice.ParticipationId);
            if (p is null) { if (notice.Kind == "EventWaitlistVacancy" && (ev.State != "Waiting" || Seats(data, ev.Id) >= ev.Definition.Capacity || !data.Participations.Any(wait => wait.EventId == ev.Id && wait.State == "Waiting")) || notice.Kind == "EventMinimumParticipants" && ev.State != "AwaitingClosure") data.EventNotices[i] = notice with { Cancelled = true }; continue; }
            if (notice.Kind == "EventPaymentDeclared" && p.PaymentDeclaredAt is null)
                data.EventNotices[i] = notice = notice with { Cancelled = true };
            if (!notice.Cancelled && (notice.ExpiresAt <= now || notice.ScheduleVersion != ev.ScheduleVersion || notice.Kind is "EventWait8" or "EventWait12" && !p.ExpectationOpen || notice.Kind == "EventGuestRequest" && (p.State != "Requested" || ev.State != "Waiting")
                || notice.Kind.StartsWith("CreditProposal:", StringComparison.Ordinal) && !(p.CreditProposals ?? []).Any(proposal => notice.Kind == "CreditProposal:" + proposal.Id && proposal.Decision is null)
                || notice.Kind is "EventReminder24" or "EventReminder1" or "EventConfirmed" or "EventChanged" && (p.State != "Confirmed" || ev.State != "Waiting")))
                data.EventNotices[i] = notice with { Cancelled = true };
        }
    }
}
