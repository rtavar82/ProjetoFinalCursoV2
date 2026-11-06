using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public static class ConsultationRules
{
    public const string TermsVersion = "individual-2026-11-01-credit-authorization";
    public static decimal Remaining(Consultation c) => ConsultationCredit.Remaining(c);
    public static bool HasDebt(Consultation c) => c.State == "Performed" && c.SettlementId is null && c.NoDebtReason is null && (c.FinalAmount is null || Remaining(c) > 0);
    public static bool HasOldDebt(Consultation c) => c.OldDebt && HasDebt(c);
    public static string ClientSection(Consultation c, DateTimeOffset now)
    {
        var state = ProcessLifecycle.Substate(c, now);
        if (ConsultationConditions.Pending(c, now)) return "Other";
        if (HasDebt(c) || ConsultationCredit.OpenPrepayment(c) || c.ExpectationOpen && state is "Confirmed" or "AwaitingClosure") return "Payments";
        if (c.ArchivedAt is not null && CanArchive(c, now) || state is "Performed" or "NoShow" or "Expired"
            || state == "Rejected" && c.CancellationOrigin != "Client") return "Closed";
        if (state is "CancelledClient" or "CancelledManager" || state == "Rejected" && c.CancellationOrigin == "Client") return "Cancelled";
        return state == "Confirmed" ? "Upcoming" : "Other";
    }
    public static bool CanArchive(Consultation c, DateTimeOffset now) => !HasDebt(c) && !c.ExpectationOpen
        && ProcessLifecycle.Substate(c, now) is "Performed" or "NoShow" or "Expired" or "Rejected" or "CancelledClient" or "CancelledManager";
    public static string ManagerSection(Consultation c, DateTimeOffset now) => ProcessLifecycle.Substate(c, now) switch
    {
        "Requested" => "Requests", "Confirmed" => ConsultationConditions.Pending(c, now) ? "Conditions" : c.ExpectationOpen || ConsultationCredit.OpenPrepayment(c) ? "AwaitingReceipt" : "Upcoming", "AwaitingClosure" => "Closure",
        "Performed" => "Performed", "NoShow" => "NoShow", "CancelledClient" or "CancelledManager" or "Rejected" or "Expired" => "Cancelled", _ => "Ended"
    };
    public static string FinancialState(Consultation c) => HasDebt(c) ? c.FinalAmount is null ? "ContributionUndefined" : c.Service.PaymentMode == "Contribution" ? "ContributionPending" : "Unpaid"
        : c.SettlementId is not null ? "Paid" : c.ExpectationOpen || ConsultationCredit.OpenPrepayment(c)
            ? c.RequiresClientAcceptance && c.AcceptedAt is null ? "ConditionsPending" : c.ExpectationOpen ? "AwaitingReceipt" : "Unpaid" : "NoDebt";
    public static bool Occupies(Consultation c, DateTimeOffset now) => ProcessLifecycle.Substate(c, now) is "Requested" or "Confirmed" or "AwaitingClosure" or "Performed" or "NoShow" || c.KeepBlocked;
    public static bool ActiveObligation(Consultation c) => HasDebt(c) || ConsultationCredit.OpenPrepayment(c) || c.ExpectationOpen && c.State == "Confirmed";
    public static bool IsPaymentNotice(ConsultationNotice n) => n.Kind == "PaymentCommunication" || n.Kind.StartsWith("VerifyPayment:", StringComparison.Ordinal);
    // Reading an alert does not verify the payment communication it refers to.
    public static bool PaymentNoticeActive(ConsultationNotice n) => IsPaymentNotice(n) && !n.Cancelled && n.ClosedBy is null && n.ClosureReason is null;
    public static bool CanReceiveForConsultation(Consultation c, ConsultationData data)
    {
        if (c.SettlementId is not null || c.State is not ("Confirmed" or "Performed")) return false;
        if (c.NoDebtReason is not null)
            return c.NoDebtReason == "Gift" && data.Notices.Any(n => n.ConsultationId == c.Id && PaymentNoticeActive(n));
        if (c.State == "Performed")
        {
            var received = Math.Max(c.ReceivedAmount, data.Entries.Where(e => e.PersonId == c.PersonId && e.ConsultationId == c.Id && e.Kind == "Receipt").Sum(e => e.Amount));
            return HasDebt(c) && (c.FinalAmount is null || received + ConsultationCredit.ExternalApplied(data, c) < c.FinalAmount);
        }
        return c.ExpectationOpen && c.AdvanceSatisfiedAt is null;
    }
    public static bool ObsoleteAdvanceNotice(ConsultationNotice notice, Consultation c) => notice.ConsultationId == c.Id
        && c.AdvanceSatisfiedAt is not null && notice.Kind is "Accepted" or "Wait8" or "Wait12";
    public static void SatisfyAdvances(ConsultationData data, DateTimeOffset now)
    {
        var receipts = data.Entries.Where(e => e.Kind == "Receipt" && e.ConsultationId is not null)
            .GroupBy(e => (e.PersonId, e.ConsultationId)).ToDictionary(g => g.Key, g => g.Sum(e => e.Amount));
        for (var i = 0; i < data.Consultations.Count; i++)
        {
            var c = data.Consultations[i];
            if (c.State == "Confirmed")
            {
                var hasAccount = ConsultationConditions.HasClientAccount(data, c.PersonId);
                // External payment already confirmed before account association keeps its completed acceptance route.
                var requiresAcceptance = hasAccount && (c.RequiresClientAcceptance || c.AdvanceSatisfiedAt is null);
                if (c.RequiresClientAcceptance != requiresAcceptance)
                {
                    c = c with { RequiresClientAcceptance = requiresAcceptance, Version = c.Version + 1 };
                    data.Consultations[i] = c;
                }
            }
            var received = Math.Max(c.ReceivedAmount, receipts.GetValueOrDefault((c.PersonId, c.Id)));
            var legacyCommunications = data.Notices.Where(n => n.ConsultationId == c.Id && n.Kind.StartsWith("VerifyPayment:", StringComparison.Ordinal))
                .Select(n => new PaymentCommunication(n.Kind["VerifyPayment:".Length..], null, n.DueAt))
                .Where(message => !c.PaymentCommunications.Any(existing => existing.Id == message.Id)).ToArray();
            if (legacyCommunications.Length > 0)
            {
                c = c with { PaymentCommunications = [..c.PaymentCommunications, ..legacyCommunications], Version = c.Version + 1 };
                data.Consultations[i] = c;
            }
            // Received money and credit already applied satisfy receipt checks. Only liquidation completes payment.
            if (!c.ExpectationOpen || !Money(c.Service.ReferencePrice) || received + ConsultationCredit.ExternalApplied(data, c) < c.Service.ReferencePrice) continue;
            var satisfied = c with { ExpectationOpen = false, AdvanceSatisfiedAt = now, AdvanceSatisfiedBalance = data.Balance(c.PersonId), Version = c.Version + 1 };
            Save(data, satisfied);
            CancelObsoleteNotices(data, satisfied);
        }
        GroupPaymentConditions.SatisfyAdvances(data, now);
    }
    private static void Require(bool valid, string message, int status = 400) { if (!valid) throw new IdentityProblem(status, message); }
    private static void Manager(ConsultationActor actor) => Require(actor.IsManager, "Esta ação exige um gestor.", 403);
    private static bool Money(decimal? amount, bool zero = false) => amount is { } a && a >= (zero ? 0 : .01m) && a <= 1000000m && decimal.Round(a, 2) == a;
    private static string Id() => Guid.NewGuid().ToString();
    private static bool Overlap(DateTimeOffset start, DateTimeOffset end, DateTimeOffset otherStart, DateTimeOffset otherEnd) => start < otherEnd && otherStart < end;
    private static void Notice(ConsultationData data, Consultation c, string kind, string? person, DateTimeOffset due, DateTimeOffset? expires = null)
    {
        if (person is not null && data.GuestRequests.Any(g => g.ConsultationId == c.Id) && !data.ClientAccountPeople.Contains(person)) return;
        if (!data.Notices.Any(n => n.ConsultationId == c.Id && n.Kind == kind && n.PersonId == person))
            data.Notices.Add(new(Id(), person, c.Id, kind, due, expires, PushState: kind.StartsWith("CreditProposal:", StringComparison.Ordinal) ? null : "Pending",
                EmailPending: kind == "BookingConfirmed" && c.FinancialChoice != "Prepayment"
                    || kind is "Approved" or "Reminder26" or "Closed" || kind.StartsWith("SharedReport:", StringComparison.Ordinal)));
    }
    public static void Advance(ConsultationData data, DateTimeOffset now)
    {
        ProcessLifecycle.Advance(data, now);
        SessionPacks.Advance(data, now);
        GroupEvents.Advance(data, now);
        var conversationOwners = data.Consultations.ToDictionary(c => c.Id);
        var messageNotices = data.Notices.Select((notice, index) => (notice, index)).Where(x => x.notice.Kind.StartsWith("FollowupMessage:", StringComparison.Ordinal)).ToLookup(x => x.notice.Kind, x => x.index);
        var messageReads = data.MessageReads.GroupBy(r => r.MessageId).ToDictionary(g => g.Key, g => g.Min(r => r.At));
        foreach (var message in data.Messages.Where(m => m.ParticipationId is null))
        {
            var owner = conversationOwners[message.ConsultationId!]; var kind = "FollowupMessage:" + message.Id;
            var read = messageReads.TryGetValue(message.Id, out var at) ? (DateTimeOffset?)at : null;
            var indexes = messageNotices[kind].ToArray();
            if (indexes.Length == 0) data.Notices.Add(new(Id(), message.AuthorIsManager ? owner.PersonId : null, owner.Id, kind, message.CreatedAt, null, ReadAt: read));
            else if (read is not null) foreach (var i in indexes) data.Notices[i] = data.Notices[i] with { ReadAt = data.Notices[i].ReadAt ?? read };
        }
        SatisfyAdvances(data, now);
        SyncBalanceNotices(data, now);
        for (var i = 0; i < data.Consultations.Count; i++)
        {
            var c = data.Consultations[i];
            if (c.State == "Confirmed" && c.StartsAt > now && data.ClientAccountPeople.Contains(c.PersonId)
                && data.GuestRequests.Any(g => g.ConsultationId == c.Id))
            {
                // Creating an account changes delivery, not the booking or its agreed financial state.
                if (ConsultationConditions.Pending(c, now)) Notice(data, c, "Approved", c.PersonId, now);
                if (c.ExpectationOpen && c.FinancialChoice == "Prepayment" && c.AcceptedAt is { } accepted)
                    foreach (var hours in new[] { 8, 12 }) Notice(data, c, "Wait" + hours, c.PersonId, accepted.AddHours(hours));
                var due26 = c.StartsAt.AddHours(-26);
                if (now <= due26 && due26 - c.CreatedAt > TimeSpan.FromHours(96)) Notice(data, c, "Reminder26", c.PersonId, due26, c.StartsAt.AddHours(-24));
                if (now <= c.StartsAt.AddHours(-2)) Notice(data, c, "Reminder2", c.PersonId, c.StartsAt.AddHours(-2), c.StartsAt);
            }
            CancelObsoleteNotices(data, c);
            if (c.State == "Expired") foreach (var recipient in new string?[] { null, c.PersonId }) Notice(data, c, "Expired", recipient, c.StartsAt);
        }
    }
    private static void CancelObsoleteNotices(ConsultationData data, Consultation c)
    {
        for (var i = 0; i < data.Notices.Count; i++)
        {
            var n = data.Notices[i];
            if (n.ConsultationId != c.Id) continue;
            var unverifiedGiftReceipt = c.State == "Performed" && c.NoDebtReason == "Gift" && PaymentNoticeActive(n);
            var obsolete = n.Kind.StartsWith("Receipt:", StringComparison.Ordinal)
                || n.Kind == "Request" && c.State != "Requested"
                || ObsoleteAdvanceNotice(n, c)
                || n.Kind == "Approved" && c.AcceptedAt is not null
                || n.Kind.StartsWith("CreditProposal:", StringComparison.Ordinal) && !c.CreditProposals.Any(p => n.Kind == "CreditProposal:" + p.Id && p.Decision is null)
                || n.Kind is "Wait8" or "Wait12" && !c.ExpectationOpen
                || n.Kind is "Reminder26" or "Reminder2" && c.State != "Confirmed"
                || IsPaymentNotice(n) && c.State is "Performed" or "CancelledClient" or "CancelledManager" or "NoShow" && !HasDebt(c) && !unverifiedGiftReceipt
                || n.Kind == "AvailabilityDecision" && c.AvailabilityDecidedAt is not null
                || n.Kind != "AvailabilityDecision" && c.State is "CancelledClient" or "CancelledManager" or "NoShow" && !HasDebt(c);
            if (obsolete && !n.Cancelled) data.Notices[i] = n with { Cancelled = true, ClosureReason = "AutomaticOutcome" };
        }
        var duplicates = data.Notices.Where(n => n.ConsultationId == c.Id && PaymentNoticeActive(n)).OrderByDescending(n => n.DueAt).ThenBy(n => n.Id).Skip(1).Select(n => n.Id).ToHashSet();
        for (var i = 0; i < data.Notices.Count; i++) if (duplicates.Contains(data.Notices[i].Id)) data.Notices[i] = data.Notices[i] with { Cancelled = true };
    }
    public static ConsultationResult Apply(ConsultationData data, ConsultationCommand input, ConsultationActor actor,
        DateTimeOffset now, Func<string, string, string, string> encrypt)
    {
        Require(Guid.TryParse(input.OperationId, out _), "A operação precisa de identificação válida.");
        Require(input.Sale is null || input.Action == "RecordSale", "Os dados de venda pertencem apenas ao registo de vendas.");
        if (input.Action == "RecordSale") return FinancialSales.Apply(data, input, actor, now, encrypt);
        Require(input.AllowClientCredit is null || actor.IsManager && input.Action is "Approve" or "Close" or "Manual" or "LinkGuestRequest",
            "A autorização de crédito só pode ser definida pela gestão na aprovação ou no fecho.");
        if (input.Action is "SendMessage" or "ReadMessages" or "BlockConversation" or "ReopenConversation")
            return ConsultationConversation.Apply(data, input, actor, now, encrypt);
        if (input.Action == "ReadDomainNotice")
        {
            if (input.Choice == "Guest")
            {
                Manager(actor);
                var index = data.GuestRequests.FindIndex(g => g.Id == input.Id);
                Require(index >= 0, "Aviso não encontrado.", 404);
                data.GuestRequests[index] = data.GuestRequests[index] with { NoticeReadAt = data.GuestRequests[index].NoticeReadAt ?? now };
            }
            else if (input.Choice == "Pack")
            {
                var index = data.PackNotices.FindIndex(n => n.Id == input.Id && (actor.IsManager || n.PersonId == actor.PersonId && !n.Kind.StartsWith("PackManager:")));
                Require(index >= 0, "Aviso não encontrado.", 404); var notice = data.PackNotices[index];
                data.PackNotices[index] = actor.IsManager ? notice with { ManagerReadAt = notice.ManagerReadAt ?? now } : notice with { ReadAt = notice.ReadAt ?? now };
            }
            else if (input.Choice == "Event")
            {
                var index = data.EventNotices.FindIndex(n => n.Id == input.Id && (actor.IsManager ? n.PersonId is null : n.PersonId == actor.PersonId));
                Require(index >= 0, "Aviso não encontrado.", 404); var notice = data.EventNotices[index];
                data.EventNotices[index] = notice with { ReadAt = notice.ReadAt ?? now };
                if (actor.IsManager && notice.ParticipationId is not null && notice.Kind.StartsWith("FollowupMessage:", StringComparison.Ordinal))
                {
                    var target = ConsultationConversation.Authorized(data, notice.ParticipationId, actor);
                    var ids = data.Messages.Where(m => m.TargetId == target.Id && !m.AuthorIsManager && m.CreatedAt <= notice.DueAt
                        && ConsultationConversation.Unread(data, m, actor)).Select(m => m.Id).ToArray();
                    if (ids.Length > 0) ConsultationConversation.MarkPresented(data, target, ids, actor, now, 1000);
                }
            }
            else throw new IdentityProblem(400, "Aviso inválido.");
            return new(input.Id!, "Aviso marcado como lido.");
        }
        if (input.Action is "RejectGuestRequest" or "LinkGuestRequest" or "ArchiveGuestRequest") return GuestConsultations.Manage(data, input, actor, now);
        if (input.Action is "AuthorizePackUse" or "ExtendPack" or "SetPackValidity" or "WithdrawPackSessions" or "SettlePack" or "ReversePackUse") return SessionPacks.Apply(data, input, actor, now, encrypt);
        if (input.Action is "SaveEvent" or "CancelEvent" or "PerformEvent" or "ReleaseEventBlock" or "JoinEvent" or "AcceptParticipationConditions" or "CancelParticipation" or "ConfirmParticipation" or "RegisterParticipation" or "CloseParticipation" or "SettleParticipation" or "UseParticipationCredit" or "DeclareParticipationPayment" or "LinkEventGuest" or "RejectEventGuest" or "ArchiveParticipation")
        { var result = GroupEvents.Apply(data, input, actor, now, encrypt); GroupEvents.Advance(data, now); return result; }
        if (input.Action == "PublishAvailability")
            return AgendaRules.Publish(data, input.Publication ?? throw new IdentityProblem(400, "Indica a publicação da agenda."), actor, input.OperationId, now, encrypt);
        if (input.Action is "SaveService" or "UpdateServiceRates" or "PublishCatalogueConsultation" or "RetireCatalogueConsultation")
        {
            Manager(actor);
            var catalogueEdit = input.Action is "PublishCatalogueConsultation" or "RetireCatalogueConsultation";
            var ratesOnly = input.Action == "UpdateServiceRates";
            ConsultationService s;
            if (catalogueEdit && input.Action == "PublishCatalogueConsultation" && input.Id is null)
                s = ConsultationRates.Edit(data, null, input.CatalogueConsultation ?? throw new IdentityProblem(400, "Indica os dados da consulta."));
            else if (ratesOnly || catalogueEdit)
            {
                var currentService = data.Services.SingleOrDefault(service => service.Id == input.Id && service.Active && service.ServiceKind is null)
                    ?? throw new IdentityProblem(404, "Consulta individual não encontrada.");
                Require(currentService.Version == input.Version, "A consulta mudou. Volta a abrir antes de guardar.", 409);
                if (input.Action == "RetireCatalogueConsultation")
                {
                    Require(!data.GuestRequests.Any(request => request.Service.Id == currentService.Id
                        && request.StartsAt > now && request.State is "Requested" or "InTreatment"),
                        "Trata primeiro os pedidos sem conta que ainda aguardam decisão para esta consulta.", 409);
                    Require(!data.Packs.Any(pack => pack.ServiceIds.Contains(currentService.Id) && SessionPacks.IsPaid(pack)
                        && SessionPacks.Remaining(data, pack.Id) > 0
                        && !ActivityCatalogue.Complete(data.Services).Any(other => other.Id != currentService.Id && other.Active
                            && other.ServiceKind != "Retreat" && !GroupEvents.IsFree(other) && pack.ServiceIds.Contains(other.Id))),
                        "Há packs com sessões disponíveis que dependem desta consulta. Trata esses packs antes de a retirar.", 409);
                    data.Services[data.Services.IndexOf(currentService)] = currentService with { Active = false, Version = currentService.Version + 1 };
                    return new(currentService.Id, "Consulta retirada do catálogo.");
                }
                s = catalogueEdit
                    ? ConsultationRates.Edit(data, currentService, input.CatalogueConsultation ?? throw new IdentityProblem(400, "Indica os dados da consulta."))
                    : ConsultationRates.Update(currentService, input.Rates ?? throw new IdentityProblem(400, "Indica a duração e o preço."));
            }
            else s = input.Service ?? throw new IdentityProblem(400, "Indica o serviço.");
            Require(!s.DefinedPerEvent || s.ServiceKind is "Group" or "Retreat", "Só grupos e retiros podem ser definidos por ocorrência.");
            Require(!string.IsNullOrWhiteSpace(s.Title) && s.Title.Length <= 200 && (s.DefinedPerEvent ? s.DurationMinutes == 0 : s.DurationMinutes is >= 15 and <= 720), "Indica título e duração válida; nos tipos definidos por ocorrência, a duração é indicada no evento.");
            Require(s.Modality is "InPerson" or "Remote" && (s.Modality == "Remote" || s.DefinedPerEvent || !string.IsNullOrWhiteSpace(s.PublicLocation)), "Indica modalidade e local presencial.");
            Require(s.PublicLocation is not null && s.Instructions is not null && s.PublicLocation.Length <= 300 && s.Instructions.Length <= 4000, "Indica local e instruções dentro dos limites.");
            Require(s.PaymentMode is "Prepayment" or "Postpayment" or "Contribution" or "Free", "Escolhe uma modalidade financeira válida.");
            Require(s.ServiceKind is null or "Group" or "Retreat" && (s.ServiceKind is null || s.Modality == "InPerson"), "Grupos e retiros exigem modalidade presencial.");
            Require(s.PaymentMode is "Contribution" or "Free" || s.DefinedPerEvent && s.ReferencePrice is null || Money(s.ReferencePrice), "Indica um preço válido.");
            Require(s.ServiceKind != "Retreat" || s.PaymentMode == "Prepayment", "Os retiros exigem pré-pagamento.");
            Require(s.ServiceKind != "Group" || s.PaymentMode != "Postpayment", "O grupo pós-pago usa contribuição livre.");
            SharingWorkshop.ValidateService(s);
            var index = data.Services.FindIndex(x => x.Id == s.Id);
            Require(index < 0 ? string.IsNullOrEmpty(s.Id) || ActivityCatalogue.IsBuiltIn(s.Id) : data.Services[index].Version == s.Version, "O serviço mudou. Atualiza antes de guardar.", 409);
            Require(!ActivityCatalogue.IsBuiltIn(s.Id) || ActivityCatalogue.Types().Single(type => type.Id == s.Id).ServiceKind == s.ServiceKind, "Mantém o tipo de grupo ou retiro deste serviço.");
            if (index >= 0 && s.BookingOptions is null) s = s with { BookingOptions = data.Services[index].BookingOptions };
            if (index >= 0 && s.Presentation is null) s = s with { Presentation = data.Services[index].Presentation };
            var previousService = index < 0 ? null : data.Services[index];
            Require(ratesOnly || catalogueEdit || s.Presentation?.PackPromotionPublished != true || input.ConditionsAccepted, "Confirma expressamente a publicação da divulgação revista.");
            s = s with { PromotionHistory = previousService?.PromotionHistory };
            if (s.Presentation?.PackPromotion != previousService?.Presentation?.PackPromotion
                || (s.Presentation?.PackPromotionPublished ?? false) != (previousService?.Presentation?.PackPromotionPublished ?? false))
                s = s with { PromotionHistory = [..previousService?.PromotionHistory ?? [], new(actor.AccountId, now,
                    previousService?.Presentation?.PackPromotion, s.Presentation?.PackPromotion, s.Presentation?.PackPromotionPublished ?? false)] };
            if (s.Presentation is { } presentation)
                Require(presentation.Introduction is { Length: <= 500 } && presentation.Description is { Length: <= 10000 }
                    && (presentation.PackPromotion?.Length ?? 0) <= 2000
                    && (string.IsNullOrWhiteSpace(presentation.PackPromotion) || s.ServiceKind != "Retreat" && s.PaymentMode != "Free" && !SharingWorkshop.Matches(s.Title))
                    && presentation.Recommendations is { Length: <= 4000 } && (presentation.PackSessions is null or >= 2 and <= 1000)
                    && (presentation.PackSessions is null || s.ServiceKind is null && s.PaymentMode is "Prepayment" or "Postpayment"), "Revê os textos e a configuração pública do pack.");
            ClientBooking.ValidateOptions(s);
            s = s with { Id = index < 0 && !ActivityCatalogue.IsBuiltIn(s.Id) ? Id() : s.Id, Version = index < 0 ? 1 : s.Version + 1,
                ReferencePrice = s.PaymentMode == "Free" ? 0 : s.PaymentMode == "Contribution" ? null : s.ReferencePrice };
            if (index < 0) data.Services.Add(s); else data.Services[index] = s;
            return new(s.Id, "Serviço guardado.");
        }
        if (input.Action is "Request" or "Manual")
        {
            if (input.Action == "Manual") Manager(actor);
            Require(input.Action == "Manual" || input.DurationMinutes is null && input.ManualReviewRevision is null, "A duração do pedido deve corresponder à opção publicada.");
            if (input.Action == "Manual" && input.ManualReviewRevision is not null)
                Require(input.ManualReviewRevision == AgendaRules.Revision(data), "A agenda mudou. Revê novamente a marcação antes de confirmar.", 409);
            var service = input.Action == "Manual" ? ManualBooking.Resolve(data, input.ServiceId, input.ServiceVersion, input.DeliveryOptionId, input.DurationMinutes)
                : data.Services.SingleOrDefault(s => s.Id == input.ServiceId && s.Active && s.ServiceKind is null) ?? throw new IdentityProblem(400, "Serviço individual indisponível.");
            if (input.Action == "Request") service = ClientBooking.Validate(data, input.ServiceId, input.StartsAt.ToUniversalTime(), input.ServiceVersion, input.DeliveryOptionId, now);
            service = PaCT.Api.Management.SitePresentation.WithAddress(data.PublishedSite, service, service.PublicLocation);
            var person = actor.IsManager ? input.PersonId : actor.PersonId;
            Require(Guid.TryParse(person, out _), "Seleciona a ficha do cliente.");
            var start = input.StartsAt.ToUniversalTime();
            Require(AgendaRules.IsBookableStart(start, now), "Escolhe um início futuro dentro dos próximos seis meses.");
            var end = start.AddMinutes(service.DurationMinutes);
            if (input.Action == "Request") ConsultationConditions.ValidateRequest(service, input.ConditionsAccepted, input.TermsVersion);
            if (input.Action == "Manual")
            {
                Require(AgendaRules.ConfirmedConflicts(data, start, end, now).Length == 0, "Existe uma marcação ou evento com inscrições confirmadas. Resolve essa situação antes de marcar.", 409);
                AgendaRules.ReplaceUnconfirmed(data, start, end, actor, now, encrypt);
                AgendaRules.RetireWindows(data, start, end, actor, now, blockedOnly: true);
            }
            AgendaRules.ValidateOccupation(data, start, end, now, manager: actor.IsManager);
            var blocks = AgendaRules.ActiveWindows(data).Where(w => !w.Available && Overlap(start, end, w.StartsAt, w.EndsAt)).ToArray();
            Require(blocks.Length == 0, "O horário está bloqueado para pedidos de clientes.", 409);
            Require(input.Action == "Manual" || AgendaRules.Allows(data, service, start, end, registered: true), "As opções devem corresponder a um horário disponibilizado.", 409);
            var c = new Consultation { Id = Id(), PersonId = person!, Service = service, StartsAt = start, EndsAt = end, CreatedAt = now };
            if (input.Action == "Request" && ConsultationConditions.AcceptAtRequest(service.PaymentMode))
                c = c with { AcceptedAt = now, AcceptedBy = actor.AccountId, AcceptedTermsVersion = input.TermsVersion };
            if (input.Action == "Manual") c = Approve(data, c, input.Choice ?? service.PaymentMode, actor, now, input.AllowClientCredit == true);
            else Notice(data, c, "Request", null, now);
            data.Consultations.Add(c); return new(c.Id, input.Action == "Manual" ? "Marcação confirmada." : "Pedido enviado. Aguarda a confirmação da terapeuta.", input.OperationId);
        }
        if (input.Action == "Receipt")
        {
            Manager(actor); Require(Guid.TryParse(input.PersonId, out _) && Money(input.Amount), "Indica cliente e valor recebido válido.");
            Require(input.Method is "Cash" or "Transfer" or "MbWay" or "Card" or "Other", "Seleciona o meio de recebimento.");
            Require(input.StartsAt > DateTimeOffset.UnixEpoch && input.StartsAt <= now, "A data do recebimento não pode ser futura.");
            Require(input.Origin is "Consultation" or "Sale" or "EventService" or "GeneralCredit" or "Pack", "Indica a origem do recebimento.");
            Require(input.Origin != "Consultation" || input.Id is not null, "Seleciona a consulta de origem.");
            Require(input.Id is null || input.Origin == "Consultation", "A consulta selecionada deve corresponder à origem do recebimento.");
            Require(input.Origin is not ("Sale" or "EventService") || !string.IsNullOrWhiteSpace(input.OriginReference) && input.OriginReference.Length <= 120, "Indica a referência da venda ou evento/serviço.");
            Require(input.Origin != "Sale" || !data.Sales.Any(s => s.Id == input.OriginReference), "Esta venda já tem o recebimento registado. Não registes o mesmo dinheiro novamente.", 409);
            Require(input.Origin != "Pack" || data.Packs.Any(p => p.Id == input.OriginReference && p.PersonId == input.PersonId), "Seleciona a compra de pack desta pessoa.");
            Require(input.Origin != "Pack" || !data.Packs.Any(p => p.Id == input.OriginReference && p.SaleId is not null), "Este pack foi vendido com o recebimento já registado.", 409);
            Consultation? c = null;
            if (input.Id is not null)
            {
                c = Find(data, input, actor);
                Require(c.PersonId == input.PersonId, "O recebimento não pertence a este cliente.", 409);
                Require(CanReceiveForConsultation(c, data), "Esta consulta não tem um recebimento pendente. Não registes novamente o mesmo pagamento.", 409);
            }
            EventParticipation? participation = null;
            if (input.Origin == "EventService")
                participation = data.Participations.SingleOrDefault(p => p.Id == input.OriginReference) ?? throw new IdentityProblem(404, "Inscrição não encontrada.");
            if (participation is not null)
            {
                var group = data.Events.Single(e => e.Id == participation.EventId);
                Require(participation.PersonId == input.PersonId, "O recebimento não pertence a este participante.", 409);
                if (input.Version > 0) Require(participation.Version == input.Version, "A inscrição mudou. Revê os valores atuais.", 409);
                if (group.Service.ServiceKind == "Group") Require(GroupPaymentConditions.CanReceive(data, group, participation),
                    "Esta participação não tem um recebimento pendente. Não registes novamente o mesmo pagamento.", 409);
                else Require(RetreatFinance.CanReceive(data, participation), "Esta inscrição não tem um recebimento pendente.", 409);
            }
            var settlesContribution = c is { State: "Performed", FinalAmount: null, NoDebtReason: null } && c.Service.PaymentMode == "Contribution";
            var entry = new CreditEntry(Id(), input.PersonId!, c?.Id, "Receipt", input.Amount!.Value, actor.AccountId, now, null, input.Method, null,
                input.StartsAt, input.Origin, input.OriginReference, Sequence: CreditLedger.NextSequence(data));
            data.Entries.Add(entry);
            if (c is not null)
            {
                var received = c.ReceivedAmount + input.Amount.Value;
                var updated = c with { ReceivedAmount = received, FinalAmount = settlesContribution ? input.Amount.Value : c.FinalAmount,
                    PaymentDeclaredAt = null, Version = c.Version + 1 };
                if (settlesContribution) updated = ConsultationCredit.SettleContributionReceipt(data, updated, actor, now, entry);
                Save(data, updated);
                ClosePaymentNotices(data, c.Id, now, actor.AccountId, "ReceiptConfirmed");
            }
            if (participation is not null)
            {
                var item = data.Events.Single(e => e.Id == participation.EventId);
                if (GroupPaymentConditions.Mode(item) == "Contribution" && participation.Attendance == "Performed" && participation.FinalAmount is null)
                {
                    participation = ParticipationCredit.ReceiveContribution(data, item, participation, entry, actor, now);
                    settlesContribution = true;
                }
                data.Participations[data.Participations.FindIndex(p => p.Id == participation.Id)] = participation with { PaymentDeclaredAt = null, Version = participation.Version + 1 };
                for (var index = 0; index < data.EventNotices.Count; index++)
                    if (data.EventNotices[index].ParticipationId == participation.Id && data.EventNotices[index].Kind == "EventPaymentDeclared")
                        data.EventNotices[index] = data.EventNotices[index] with { ReadAt = now, Cancelled = true };
            }
            SatisfyAdvances(data, now);
            SyncBalanceNotices(data, now);
            return new(entry.Id, settlesContribution ? participation is not null ? "Contribuição recebida e participação paga." : "Contribuição recebida e consulta paga." : "Recebimento registado em crédito.");
        }
        if (input.Action is "Adjustment" or "ReverseAdjustment") return AdjustBalance(data, input, actor, now, encrypt);
        if (input.Action == "RetryBalancePush")
        {
            Manager(actor);
            var index = data.BalanceNotices.FindIndex(n => n.Id == input.Id && n.ClosedAt is null && n.PushState is "Uncertain" or "Failed");
            Require(index >= 0, "O aviso não tem um envio para rever.", 409);
            data.BalanceNotices[index] = data.BalanceNotices[index] with { PushState = "Pending" };
            return new(input.Id!, "Nova tentativa autorizada. O envio anterior pode ter sido entregue; não altera o saldo.");
        }
        if (input.Action == "ReadBalanceNotice")
        {
            var index = data.BalanceNotices.FindIndex(n => n.Id == input.Id && (actor.IsManager || n.PersonId == actor.PersonId));
            Require(index >= 0, "Aviso não encontrado.", 404);
            var notice = data.BalanceNotices[index];
            data.BalanceNotices[index] = actor.IsManager ? notice with { ManagerReadAt = now } : notice with { ClientReadAt = now };
            return new(notice.Id, "Aviso lido. A dívida permanece até o saldo deixar de ser negativo.");
        }
        if (input.Action is "Refund" or "ReverseReceipt" or "ReverseRefund")
            return CorrectCredit(data, input, actor, now, encrypt);
        if (input.Action is "ReadNotice" or "ReadMessageNotice")
        {
            if (input.Action == "ReadMessageNotice") Manager(actor);
            var index = data.Notices.FindIndex(n => n.Id == input.Id && (actor.IsManager ? n.PersonId is null : n.PersonId == actor.PersonId));
            Require(index >= 0, "Aviso não encontrado.", 404);
            var n = data.Notices[index];
            Require(input.Action != "ReadMessageNotice" || n.Kind.StartsWith("FollowupMessage:", StringComparison.Ordinal), "Este aviso não corresponde a mensagens de acompanhamento.");
            if (input.Action == "ReadMessageNotice") _ = ConsultationConversation.Authorized(data, n.ConsultationId, actor);
            data.Notices[index] = n with { ReadAt = n.ReadAt ?? now };
            if (n.Kind.StartsWith("FollowupMessage:", StringComparison.Ordinal))
            {
                var sequences = data.Messages.Where(m => m.ConsultationId == n.ConsultationId).ToDictionary(m => "FollowupMessage:" + m.Id, m => m.Sequence);
                var through = sequences.GetValueOrDefault(n.Kind);
                if (input.Action == "ReadMessageNotice")
                {
                    foreach (var message in data.Messages.Where(m => m.ConsultationId == n.ConsultationId && m.Sequence <= through && ConsultationConversation.Unread(data, m, actor)))
                        data.MessageReads.Add(new(Id(), message.Id, actor.AccountId, now));
                }
                for (var i = 0; i < data.Notices.Count; i++)
                    if (data.Notices[i] is var related && related.ConsultationId == n.ConsultationId && related.PersonId == n.PersonId
                        && sequences.TryGetValue(related.Kind, out var sequence) && sequence <= through)
                        data.Notices[i] = related with { ReadAt = related.ReadAt ?? now };
            }
            return new(n.Id, "Aviso consultado.");
        }
        var current = ProcessLifecycle.At(Find(data, input, actor), now); var next = current;
        switch (input.Action)
        {
            case "Approve":
                Manager(actor); next = Approve(data, current, input.Choice ?? current.Service.PaymentMode, actor, now, input.AllowClientCredit == true); break;
            case "UseAuthorizedCredit":
                next = ConsultationCredit.Use(data, current, actor, now, input.Amount); break;
            case "Reject":
                Require(ProcessLifecycle.Substate(current, now) == "Requested", "Só é possível recusar ou desistir de um pedido ainda válido.", 409);
                next = current with { State = "Rejected", CancellationOrigin = actor.IsManager ? "Management" : "Client", CancelledBy = actor.AccountId, CancelledAt = now }; break;
            case "Accept":
                Require(!actor.IsManager, "A aceitação das condições só pode ser feita pelo cliente com conta.", 403);
                Require(ProcessLifecycle.Substate(current, now) == "Confirmed", "Não existem condições de uma consulta aprovada por aceitar antes do início.", 409);
                Require(input.Amount is null, "A utilização de crédito é confirmada separadamente, depois de aceitar as condições.");
                Require(input.ConditionsAccepted && input.TermsVersion == ConsultationConditions.Version(current), "Confirma que leste e aceitas as condições apresentadas.");
                if (current.AcceptedAt is null)
                {
                    next = current with { AcceptedAt = now, AcceptedTermsVersion = ConsultationConditions.Version(current), AcceptedBy = actor.AccountId };
                    Notice(data, current, "Accepted", null, now);
                    if (current.ExpectationOpen && current.FinancialChoice == "Prepayment")
                        foreach (var hours in new[] { 8, 12 }) foreach (var recipient in new string?[] { null, current.PersonId })
                            Notice(data, current, "Wait" + hours, recipient, now.AddHours(hours));
                }
                break;
            case "Cancel":
                Require(ProcessLifecycle.Substate(current, now) == "Confirmed", "O cancelamento normal só é permitido antes do início de uma marcação confirmada.", 409);
                var financial = actor.IsManager && input.Choice == "FinancialWait";
                Require(!financial || current.ExpectationOpen && current.AcceptedAt is { } accepted && now >= accepted.AddHours(8), "Este cancelamento não pertence ao percurso de espera financeira.", 409);
                var origin = !actor.IsManager || input.Choice == "Client" ? "Client" : "Management";
                Require(!actor.IsManager || input.AvailabilityChoice is "Release" or "Keep", "Escolhe se o horário fica livre ou bloqueado.");
                next = current with { State = origin == "Client" ? "CancelledClient" : "CancelledManager", CancellationOrigin = origin,
                    CreditProposals = FinancialProposals.End(current.CreditProposals, actor.AccountId, now),
                    CancelledBy = actor.AccountId, CancelledAt = now, ExpectationOpen = false, NoDebtReason = "Cancellation", FinalAmount = 0, KeepBlocked = !actor.IsManager || input.AvailabilityChoice == "Keep",
                    AvailabilityDecidedAt = actor.IsManager ? now : null, AvailabilityDecidedBy = actor.IsManager ? actor.AccountId : null };
                next = ConsultationCredit.Reconcile(data, next, actor, now, 0);
                if (!actor.IsManager) Notice(data, next, "AvailabilityDecision", null, now);
                break;
            case "Release":
            case "Keep":
                Manager(actor); Require(current.State is "CancelledClient" or "CancelledManager" && (current.KeepBlocked || current.AvailabilityDecidedAt is null), "Não existe um cancelamento com disponibilidade por decidir.", 409);
                next = current with { KeepBlocked = input.Action == "Keep", AvailabilityDecidedAt = now, AvailabilityDecidedBy = actor.AccountId }; break;
            case "Close":
                Manager(actor); Require(ProcessLifecycle.Substate(current, now) == "AwaitingClosure", "Só é possível fechar uma marcação confirmada cujo início já foi atingido.", 409);
                Require(input.Choice is "Performed" or "NoShow" or "CancelledManager", "Escolhe o resultado real.");
                var performed = input.Choice == "Performed";
                Require(input.Choice != "CancelledManager" || input.AvailabilityChoice is "Release" or "Keep", "Escolhe se o horário cancelado fica livre ou bloqueado.");
                Require(!performed || input.StartsAt > DateTimeOffset.UnixEpoch && input.EndsAt > input.StartsAt && input.EndsAt <= now, "Indica o início e fim efetivos já ocorridos.");
                Require(!performed || input.Method is "Unpaid" or "Settle" or "Gift" or "Free" or "Undefined" or "Pack", "Escolhe o tratamento financeiro.");
                Require(input.SettlementAmount is null || performed && input.Method == "Settle", "Só uma consulta realizada com liquidação monetária pode utilizar crédito.");
                Require(performed || input.PackId is null && input.Method != "Pack", "Uma falta ou cancelamento nunca consome sessões de pack.");
                Require(!performed || input.Method != "Undefined" || current.Service.PaymentMode == "Contribution", "Só a contribuição livre pode ficar por definir.");
                Require(!performed || input.Method != "Free" || current.Service.PaymentMode == "Free", "Gratuitidade exige serviço gratuito; para oferecer utiliza Oferta.");
                var noDebt = !performed ? input.Choice : input.Method == "Pack" ? "Pack" : input.Method == "Gift" ? "Gift" : current.Service.PaymentMode == "Free" ? "Free" : null;
                var final = noDebt is not null ? 0m : input.Method == "Undefined" ? (decimal?)null : input.Amount;
                Require(!performed || noDebt is not null || input.Method == "Undefined" || Money(final), "Indica o valor final positivo ou uma oferta explícita.");
                Require((input.SharedNote?.Length ?? 0) <= 8000 && (input.PrivateNote?.Length ?? 0) <= 8000, "As notas não podem exceder 8000 caracteres.");
                ClosureMediaStore.ValidateReferences(input);
                Require(input.PhotoIds.Distinct(StringComparer.Ordinal).Count() == input.PhotoIds.Length && (performed || input.PhotoIds.Length == 0), "As fotografias exigem uma consulta realizada e referências diferentes.");
                next = current with { State = input.Choice!, ClosedAt = now, ClosedBy = actor.AccountId, FinalAmount = final, NoDebtReason = noDebt,
                    CancellationOrigin = input.Choice == "CancelledManager" ? "Management" : null,
                    CancelledBy = input.Choice == "CancelledManager" ? actor.AccountId : null,
                    CancelledAt = input.Choice == "CancelledManager" ? now : null,
                    KeepBlocked = input.Choice == "CancelledManager" && input.AvailabilityChoice == "Keep",
                    AvailabilityDecidedAt = input.Choice == "CancelledManager" ? now : null,
                    AvailabilityDecidedBy = input.Choice == "CancelledManager" ? actor.AccountId : null,
                    ActualStartsAt = performed ? input.StartsAt : null, ActualEndsAt = performed ? input.EndsAt : null,
                    ExpectationOpen = noDebt is null && current.ExpectationOpen,
                    SharedNoteCiphertext = performed && !string.IsNullOrWhiteSpace(input.SharedNote) ? encrypt(current.Id, "shared", input.SharedNote) : null,
                    PrivateNoteCiphertext = !string.IsNullOrWhiteSpace(input.PrivateNote) ? encrypt(current.Id, "private", input.PrivateNote) : null, PhotoIds = performed ? input.PhotoIds : [],
                    SharedClosureMedia = performed ? input.SharedClosureMedia : null, PrivateClosureMedia = input.PrivateClosureMedia };
                next = next with { NoteHistory = [..next.NoteHistory,
                    new(next.PublicContentVersion, "Shared", actor.AccountId, now, next.SharedNoteCiphertext),
                    new(next.PublicContentVersion, "Private", actor.AccountId, now, next.PrivateNoteCiphertext)] };
                next = ConsultationCredit.Reconcile(data, next, actor, now, final ?? current.SettledAmount);
                if (performed && input.Method == "Pack")
                {
                    Require(Guid.TryParse(input.PackId, out _), "Seleciona o pack a utilizar.");
                    SessionPacks.Consume(data, input.PackId!, current.PersonId, current.Id, current.Service.Id, "Consultation", input.StartsAt, actor, now);
                    next = next with { FinancialChoice = "Pack" };
                }
                if (performed && input.Method == "Settle" && noDebt is null)
                {
                    next = Settle(data, next, actor, now, input.SettlementAmount);
                    next = next with { CreditProposals = FinancialProposals.Resolve(next.CreditProposals, null, actor, now, "Applied", input.SettlementAmount ?? next.FinalAmount) };
                }
                if (noDebt is not null) next = next with { CreditProposals = FinancialProposals.Resolve(next.CreditProposals, null, actor, now, "NotUsed") };
                next = ConsultationCredit.Authorize(data, next, actor, now, "Closure", performed && noDebt is null && input.AllowClientCredit == true);
                if (performed) Notice(data, next, "Closed", next.PersonId, now);
                break;
            case "CorrectFinalAmount":
                next = CorrectFinalAmount(data, current, input, actor, now, encrypt);
                break;
            case "MoveToOldDebts":
                Manager(actor); Require(HasDebt(current), "Esta consulta não tem uma cobrança por regularizar.", 409);
                Require(!current.OldDebt, "Esta consulta já está em Dívidas antigas.", 409);
                next = current with { OldDebt = true, CollectionHistory = [..current.CollectionHistory, new(Id(), true, actor.AccountId, now, null)] }; break;
            case "Settle":
                var resolved = FinancialProposals.Resolve(current.CreditProposals, input.RelatedId, actor, now, "Applied", input.Amount ?? Remaining(current));
                next = Settle(data, current, actor, now, input.Amount);
                next = next with { CreditProposals = resolved }; break;
            case "DeclineCreditProposal":
                Manager(actor);
                next = current with { CreditProposals = FinancialProposals.Resolve(current.CreditProposals, input.RelatedId, actor, now, "Declined") }; break;
            case "DeclarePayment":
                Require(!actor.IsManager && (HasDebt(current) || current.ExpectationOpen), "Não é possível comunicar pagamento nesta consulta. Contacta a terapeuta.", 409);
                next = current with { PaymentDeclaredAt = now, PaymentCommunications = [..current.PaymentCommunications, new(input.OperationId, actor.AccountId, now)] };
                var active = data.Notices.FindIndex(n => n.ConsultationId == current.Id && PaymentNoticeActive(n));
                if (active < 0) data.Notices.Add(new(Id(), null, current.Id, "PaymentCommunication", now, null));
                else data.Notices[active] = data.Notices[active] with { DueAt = now, ReadAt = null };
                break;
            case "Archive":
                Require(!actor.IsManager && CanArchive(current, now), "Só podes arquivar um processo terminado sem pendência financeira.", 409);
                Require(input.PublicContentVersion == current.PublicContentVersion, "A informação partilhada mudou. Consulta a versão atual antes de a marcar como vista.", 409);
                if (input.MessageIds is { Length: > 0 }) ConsultationConversation.MarkPresented(data, current, input.MessageIds, actor, now, 1000);
                next = current with { ArchivedAt = now, ArchivedBy = actor.AccountId, ArchivedContentVersion = current.PublicContentVersion,
                    ReadHistory = current.ReadHistory.Any(r => r.AccountId == actor.AccountId && r.PublicContentVersion == current.PublicContentVersion) ? current.ReadHistory : [..current.ReadHistory, new(actor.AccountId, current.PublicContentVersion, now)] };
                for (var i = 0; i < data.Notices.Count; i++)
                {
                    var notice = data.Notices[i];
                    if (notice.ConsultationId == current.Id && notice.PersonId == actor.PersonId && (notice.Kind == "Closed" || notice.Kind.StartsWith("SharedReport:", StringComparison.Ordinal)))
                        data.Notices[i] = notice with { ReadAt = notice.ReadAt ?? now, ClosedBy = actor.AccountId, ClosureReason = "ReportRead" };
                }
                break;
            default: throw new IdentityProblem(400, "Ação desconhecida.");
        }
        Save(data, next with { Version = current.Version + 1 });
        SatisfyAdvances(data, now);
        SyncBalanceNotices(data, now);
        return new(current.Id, input.Action == "Accept" ? "Condições aceites." : input.Action == "UseAuthorizedCredit" ? "Crédito utilizado. A situação de pagamento foi atualizada." : "Operação concluída.");
    }
    public static bool CanCorrectFinalAmount(Consultation c) =>
        c.State == "Performed" && c.ClosedAt is not null && c.NoDebtReason is null && Money(c.FinalAmount);

    public static ConsultationPriceCorrectionPreview PreviewFinalAmount(ConsultationData data, string id, ConsultationPriceCorrectionInput input, ConsultationActor actor)
    {
        Manager(actor);
        var c = data.Consultations.SingleOrDefault(c => c.Id == id) ?? throw new IdentityProblem(404, "Consulta não encontrada.");
        Require(c.Version == input.Version, "A consulta mudou. Atualiza antes de decidir.", 409);
        return PreviewFinalAmount(data, c, input.Amount);
    }

    private static ConsultationPriceCorrectionPreview PreviewFinalAmount(ConsultationData data, Consultation c, decimal? amount)
    {
        Require(CanCorrectFinalAmount(c), "Só é possível retificar o valor definido de uma consulta realizada e fechada a pagamento.", 409);
        Require(Money(amount) && amount != c.FinalAmount, "Indica um novo valor final positivo e diferente do atual.");
        var previous = c.FinalAmount!.Value;
        var revised = amount!.Value;
        var debits = data.Entries.Where(e => e.ConsultationId == c.Id && e.PersonId == c.PersonId && e.Kind == "Settlement").ToArray();
        var debitIds = debits.Select(e => e.Id).ToHashSet();
        var returns = data.Entries.Where(e => e.Kind == "SettlementReturn" && e.OriginalId is not null && debitIds.Contains(e.OriginalId)).Sum(e => e.Amount);
        Require(returns - debits.Sum(e => e.Amount) == c.SettledAmount
            && c.SettledAmount >= 0 && c.SettledAmount <= previous
            && (c.SettlementId is null ? c.SettledAmount < previous : c.SettledAmount == previous && debitIds.Contains(c.SettlementId)),
            "A liquidação anterior exige revisão antes de retificar o valor.", 409);
        var balance = data.Balance(c.PersonId);
        var restore = Math.Max(0, c.SettledAmount - revised);
        return new(c.Version, previous, revised, Remaining(c), Math.Max(0, revised - c.SettledAmount), balance, balance + restore, restore);
    }

    private static Consultation CorrectFinalAmount(ConsultationData data, Consultation c, ConsultationCommand input,
        ConsultationActor actor, DateTimeOffset now, Func<string, string, string, string> encrypt)
    {
        Manager(actor);
        var preview = PreviewFinalAmount(data, c, input.Amount);
        Require(preview.BalanceBefore == input.ExpectedBalance, "O saldo mudou ou ainda não foi revisto. Revê a correção antes de confirmar.", 409);
        Require(!string.IsNullOrWhiteSpace(input.Reason) && input.Reason.Length <= 2000, "Indica a justificação privada, até 2000 caracteres.");
        var reason = encrypt(c.Id, "price-correction", input.Reason!.Trim());
        var entryCount = data.Entries.Count;
        var next = ConsultationCredit.Reconcile(data, c, actor, now, preview.Amount);
        var revision = new ConsultationPriceRevision(input.OperationId, preview.PreviousAmount, preview.Amount, reason, actor.AccountId,
            now, data.Entries.Skip(entryCount).Select(e => e.Id).ToArray());
        var newDebt = preview.DebtBefore == 0 && preview.DebtAfter > 0;
        return next with
        {
            FinalAmount = preview.Amount,
            PriceHistory = [..c.PriceHistory, revision],
            OldDebt = c.OldDebt && !newDebt,
            PaymentDeclaredAt = newDebt ? null : c.PaymentDeclaredAt
        };
    }
    public static void SyncBalanceNotices(ConsultationData data, DateTimeOffset now)
    {
        foreach (var person in data.Entries.Select(e => e.PersonId).Concat(data.BalanceNotices.Select(n => n.PersonId)).Distinct())
        {
            var debt = Math.Max(0, -data.Balance(person));
            var duplicates = data.BalanceNotices.Where(n => n.PersonId == person && n.ClosedAt is null)
                .OrderBy(n => n.CreatedAt).ThenBy(n => n.Id).Skip(1).Select(n => n.Id).ToHashSet();
            for (var i = 0; i < data.BalanceNotices.Count; i++)
                if (duplicates.Contains(data.BalanceNotices[i].Id)) data.BalanceNotices[i] = data.BalanceNotices[i] with { ClosedAt = now, UpdatedAt = now };
            var active = data.BalanceNotices.FindIndex(n => n.PersonId == person && n.ClosedAt is null);
            if (debt > 0 && active < 0) data.BalanceNotices.Add(new(Id(), person, debt, now, now));
            else if (active >= 0)
            {
                var notice = data.BalanceNotices[active];
                if (notice.Amount != debt || debt == 0)
                    data.BalanceNotices[active] = notice with { Amount = debt, UpdatedAt = now, ClosedAt = debt == 0 ? now : null };
            }
        }
    }
    private static ConsultationResult AdjustBalance(ConsultationData data, ConsultationCommand input, ConsultationActor actor,
        DateTimeOffset now, Func<string, string, string, string> encrypt)
    {
        Manager(actor);
        Require(!string.IsNullOrWhiteSpace(input.Reason) && input.Reason.Length <= 2000, "Indica a justificação privada, até 2000 caracteres.");
        var original = input.Id is null ? null : data.Entries.SingleOrDefault(e => e.Id == input.Id)
            ?? throw new IdentityProblem(404, "Movimento de origem não encontrado.");
        string person; decimal amount;
        if (input.Action == "ReverseAdjustment")
        {
            Require(original is not null && original.Kind == "Adjustment", "Seleciona a correção a anular.", 409);
            Require(!data.Entries.Any(e => e.Kind == "AdjustmentReversal" && e.OriginalId == original!.Id), "Esta correção já foi anulada.", 409);
            Require(input.Amount is null || input.Amount == -original!.Amount, "A compensação é integral e calculada automaticamente.", 409);
            person = original!.PersonId; amount = -original.Amount;
        }
        else
        {
            Require(Guid.TryParse(input.PersonId, out _) && input.Amount is { } a && a != 0 && a is >= -1000000m and <= 1000000m && decimal.Round(a, 2) == a, "Indica cliente e valor da correção (positivo ou negativo, até duas casas decimais).");
            person = input.PersonId!; amount = input.Amount!.Value;
            Require(original is null || original.PersonId == person, "O movimento de origem pertence a outro cliente.", 409);
        }
        var id = Id();
        data.Entries.Add(new(id, person, null, input.Action == "Adjustment" ? "Adjustment" : "AdjustmentReversal",
            amount, actor.AccountId, now, original?.Id, null, encrypt(id, "reason", input.Reason!), now, "Correction",
            Sequence: CreditLedger.NextSequence(data)));
        SatisfyAdvances(data, now); SyncBalanceNotices(data, now);
        return new(id, "Correção registada. Os estados finais das consultas não foram alterados.");
    }
    private static Consultation Find(ConsultationData data, ConsultationCommand input, ConsultationActor actor)
    {
        var c = data.Consultations.SingleOrDefault(c => c.Id == input.Id && (actor.IsManager || c.PersonId == actor.PersonId))
            ?? throw new IdentityProblem(404, "Consulta não encontrada.");
        Require(c.Version == input.Version, "A consulta mudou. Atualiza antes de decidir.", 409); return c;
    }
    private static void Save(ConsultationData data, Consultation c)
    {
        data.Consultations[data.Consultations.FindIndex(x => x.Id == c.Id)] = c; CancelObsoleteNotices(data, c);
    }
    internal static Consultation Approve(ConsultationData data, Consultation c, string choice, ConsultationActor actor, DateTimeOffset now, bool allowClientCredit = false)
    {
        Require(ProcessLifecycle.Substate(c, now) == "Requested", "O pedido não está disponível para aprovação.", 409);
        Require(c.AcceptedAt is null || choice == c.Service.PaymentMode,
            "O cliente já aceitou as condições do pedido. Não podes alterar o formato de pagamento na aprovação.", 409);
        AgendaRules.ValidateOccupation(data, c.StartsAt, c.EndsAt, now, c.Id, manager: true);
        ValidateFinancialChoice(data, c.Service, c.PersonId, choice);
        c = c with { State = "Confirmed", Stage = ProcessStage.Booking,
            StageHistory = [..c.StageHistory, new(c.Stage, ProcessStage.Booking, now, actor.AccountId)],
            ApprovedAt = now, ApprovedBy = actor.AccountId, FinancialChoice = choice, ExpectationOpen = choice == "Prepayment",
            RequiresClientAcceptance = ConsultationConditions.HasClientAccount(data, c.PersonId) };
        c = ConsultationCredit.Authorize(data, c, actor, now, "Approval", allowClientCredit);
        Notice(data, c, c.AcceptedAt is not null || !c.RequiresClientAcceptance ? "BookingConfirmed" : "Approved", c.PersonId, now);
        var due26 = c.StartsAt.AddHours(-26);
        if (now <= due26 && due26 - c.CreatedAt > TimeSpan.FromHours(96)) Notice(data, c, "Reminder26", c.PersonId, due26, c.StartsAt.AddHours(-24));
        if (now <= c.StartsAt.AddHours(-2)) foreach (var recipient in new string?[] { null, c.PersonId }) Notice(data, c, "Reminder2", recipient, c.StartsAt.AddHours(-2), c.StartsAt);
        return c;
    }
    internal static void ValidateFinancialChoice(ConsultationData data, ConsultationService service, string personId, string choice)
    {
        Require(choice is "Prepayment" or "Postpayment" or "Contribution" or "Free" or "Gift", "Escolhe uma opção financeira disponível.");
        Require(choice != "Free" || service.PaymentMode == "Free", "Para oferecer um serviço não gratuito, escolhe Oferta.");
        Require(choice != "Contribution" || service.PaymentMode == "Contribution", "O serviço não é de contribuição livre.");
        Require(choice != "Prepayment" || Money(service.ReferencePrice), "O pré-pagamento exige valor definido.");
    }
    private static Consultation Settle(ConsultationData data, Consultation c, ConsultationActor actor, DateTimeOffset now, decimal? requestedAmount = null)
    {
        return ConsultationCredit.Settle(data, c, actor, now, requestedAmount);
    }
    private static void ClosePaymentNotices(ConsultationData data, string id, DateTimeOffset now, string authorId, string reason)
    {
        for (var i = 0; i < data.Notices.Count; i++)
            if (data.Notices[i].ConsultationId == id && PaymentNoticeActive(data.Notices[i])) data.Notices[i] = data.Notices[i] with { ReadAt = now, ClosedBy = authorId, ClosureReason = reason };
    }
    private static ConsultationResult CorrectCredit(ConsultationData data, ConsultationCommand input, ConsultationActor actor, DateTimeOffset now, Func<string, string, string, string> encrypt)
    {
        Manager(actor);
        Require(!string.IsNullOrWhiteSpace(input.Reason) && input.Reason.Length <= 2000, "Indica o motivo, até 2000 caracteres.");
        CreditEntry? original = null;
        var person = input.PersonId;
        decimal amount;
        CreditAllocation[]? allocations = null;
        if (input.Action == "Refund")
        {
            Require(Guid.TryParse(person, out _) && Money(input.Amount), "Indica cliente e montante a devolver.");
            Require(input.StartsAt > DateTimeOffset.UnixEpoch && input.StartsAt <= now, "Indica a data efetiva da devolução, não futura.");
            Require(input.Method is "Cash" or "Transfer" or "MbWay" or "Card" or "Other", "Seleciona o método da devolução.");
            amount = -input.Amount!.Value;
            Require(data.Balance(person!) >= -amount, "A devolução excede o saldo disponível.", 409);
            allocations = CreditLedger.Allocate(data, person!, -amount);
        }
        else
        {
            original = data.Entries.SingleOrDefault(e => e.Id == input.Id) ?? throw new IdentityProblem(404, "Movimento não encontrado.");
            Require(original.Kind == (input.Action == "ReverseReceipt" ? "Receipt" : "Refund"), "O tipo do movimento não corresponde à correção.", 409);
            Require(input.Amount is null || input.Amount == Math.Abs(original.Amount), "A anulação do movimento tem de ser integral.", 409);
            Require(!data.Entries.Any(e => e.Kind == "Reversal" && e.OriginalId == original.Id), "Este movimento já foi anulado.", 409);
            person = original.PersonId; amount = -original.Amount;
            if (amount < 0)
            {
                var available = CreditLedger.Available(data, person).GetValueOrDefault(original.Id);
                var related = data.Entries.Where(e => e.PersonId == person && e.Amount < 0 && !data.Entries.Any(r => r.Kind == "Reversal" && r.OriginalId == e.Id)
                    && (e.Allocations is null || e.Allocations.Any(a => a.ReceiptId == original.Id))).Select(e => e.Id);
                Require(available >= -amount && data.Balance(person) >= -amount,
                    "O recebimento tem utilizações por regularizar. Movimentos relacionados: " + string.Join(", ", related) + ". Nenhum movimento foi alterado.", 409);
                allocations = [new(original.Id, -amount)];
            }
        }
        var id = Id(); data.Entries.Add(new(id, person!, original?.ConsultationId, input.Action == "Refund" ? "Refund" : "Reversal", amount,
            actor.AccountId, now, original?.Id, input.Method, encrypt(id, "reason", input.Reason!),
            input.Action == "Refund" ? input.StartsAt : now, original?.Origin ?? "GeneralCredit", original?.OriginReference, allocations, CreditLedger.NextSequence(data)));
        SatisfyAdvances(data, now);
        SyncBalanceNotices(data, now);
        return new(id, "Movimento registado. O histórico e os resultados das consultas foram preservados.");
    }
}
