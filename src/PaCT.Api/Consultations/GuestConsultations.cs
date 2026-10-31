using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public sealed record GuestSubmission(string OperationId, string ServiceId,
    [property: JsonConverter(typeof(ExplicitInstantConverter))] DateTimeOffset StartsAt,
    string FirstName, string LastName, string DialCode, string Phone, string? Email = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? ServiceVersion = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? DeliveryOptionId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Locality = null);
public sealed record GuestContact(string FirstName, string LastName, string DialCode, string Phone, string? Email, string? Locality = null);
public sealed record GuestDecision(string Action, string AuthorId, DateTimeOffset At, string? PersonId);
public sealed record GuestConsultationRequest(string Id, string OperationId, string RequestHash, ConsultationService Service,
    DateTimeOffset StartsAt, DateTimeOffset EndsAt, DateTimeOffset CreatedAt, string ContactCiphertext,
    string State = "Requested", long Version = 1, string? PersonId = null, string? ConsultationId = null, GuestDecision[]? History = null, DateTimeOffset? NoticeReadAt = null,
    [property: JsonRequired] ProcessStage Stage = ProcessStage.Request, string? CancellationOrigin = null,
    DateTimeOffset? ArchivedAt = null, string? ArchivedBy = null);

public static class GuestConsultations
{
    public static bool Occupies(GuestConsultationRequest request, DateTimeOffset now) => ProcessLifecycle.Substate(request, now) is "Requested" or "InTreatment";
    public static bool CanArchive(GuestConsultationRequest request, DateTimeOffset now) => ProcessLifecycle.Substate(request, now) is "Expired" or "Rejected";
    public static GuestSubmission Normalize(GuestSubmission input, bool requireLocality = true)
    {
        if (!Guid.TryParse(input.OperationId, out _) || !Guid.TryParse(input.ServiceId, out _)) throw new IdentityProblem(400, "Não foi possível identificar o pedido ou a consulta escolhida.");
        var phone = IdentityValidation.RequiredPhone(input.DialCode, input.Phone);
        return input with { OperationId = Guid.Parse(input.OperationId).ToString("D"), ServiceId = Guid.Parse(input.ServiceId).ToString("D"), StartsAt = input.StartsAt.ToUniversalTime(),
            FirstName = IdentityValidation.Required(input.FirstName, 100, "o nome"), LastName = IdentityValidation.Required(input.LastName, 100, "o apelido"),
            DialCode = phone.DialCode, Phone = phone.Number, Email = string.IsNullOrWhiteSpace(input.Email) ? null : IdentityValidation.Email(input.Email),
            Locality = requireLocality || input.Locality is not null ? IdentityValidation.Required(input.Locality, 150, "a localidade") : null };
    }
    public static ConsultationResult Submit(ConsultationData data, GuestSubmission raw, DateTimeOffset now, Func<string, string, string, string> encrypt)
    {
        var input = Normalize(raw, requireLocality: false);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(input))));
        var previous = data.GuestRequests.SingleOrDefault(x => x.OperationId == input.OperationId);
        if (previous is not null)
        {
            if (previous.RequestHash != hash) throw new IdentityProblem(409, "Esta identificação já foi usada para outro pedido.");
            return new(previous.Id, "Pedido recebido. Aguarda o contacto da terapeuta.");
        }
        // Replaying an already recorded request must still work for an older open form.
        // Every new request requires the locality before creating any records.
        input = Normalize(input);
        var service = ClientBooking.Validate(data, input.ServiceId, input.StartsAt, input.ServiceVersion, input.DeliveryOptionId, now, registered: false);
        if (!AgendaRules.IsBookableStart(input.StartsAt, now)) throw new IdentityProblem(400, "Escolhe um horário futuro dentro dos próximos seis meses.");
        var end = input.StartsAt.AddMinutes(service.DurationMinutes);
        AgendaRules.ValidateOccupation(data, input.StartsAt, end, now);
        if (!AgendaRules.Covers(data, input.StartsAt, end) || AgendaRules.ActiveWindows(data).Any(w => !w.Available && AgendaRules.Overlaps(input.StartsAt, end, w.StartsAt, w.EndsAt)))
            throw new IdentityProblem(409, "Este horário já não está disponível. Escolhe outro horário.");
        var id = Guid.NewGuid().ToString("D");
        var contact = new GuestContact(input.FirstName, input.LastName, input.DialCode, input.Phone, input.Email, input.Locality);
        data.GuestRequests.Add(new(id, input.OperationId, hash, service, input.StartsAt, end, now, encrypt(id, "guest-contact", JsonSerializer.Serialize(contact)), PersonId: Guid.NewGuid().ToString()));
        return new(id, "Pedido recebido. Aguarda o contacto da terapeuta.");
    }
    public static ConsultationResult Manage(ConsultationData data, ConsultationCommand input, ConsultationActor actor, DateTimeOffset now)
    {
        var index = data.GuestRequests.FindIndex(x => x.Id == input.Id);
        if (index < 0) throw new IdentityProblem(404, "Pedido não encontrado.");
        var request = data.GuestRequests[index];
        if (input.Action == "ArchiveGuestRequest")
        {
            if (actor.IsManager || request.PersonId != actor.PersonId) throw new IdentityProblem(403, "Esta ação não está disponível.");
            if (request.Version != input.Version || !CanArchive(request, now)) throw new IdentityProblem(409, "Só podes arquivar um pedido terminado. Revê a informação atual.");
            data.GuestRequests[index] = request with { ArchivedAt = request.ArchivedAt ?? now, ArchivedBy = actor.AccountId, Version = request.Version + 1 };
            return new(request.Id, "Pedido enviado para o histórico.");
        }
        if (!actor.IsManager && (input.Action != "RejectGuestRequest" || request.PersonId != actor.PersonId)) throw new IdentityProblem(403, "Esta ação não está disponível.");
        if (request.Version != input.Version || !Occupies(request, now)) throw new IdentityProblem(409, "O pedido mudou ou expirou. Revê a informação atual.");
        var next = request;
        if (input.Action == "RejectGuestRequest") next = request with { State = "Rejected", CancellationOrigin = actor.IsManager ? "Management" : "Client" };
        else if (input.Action == "LinkGuestRequest")
        {
            if (!Guid.TryParse(input.PersonId, out _)) throw new IdentityProblem(400, "Seleciona a ficha cuja identidade verificaste.");
            if (input.PersonId != request.PersonId && !input.ConditionsAccepted) throw new IdentityProblem(400, "Confirma que verificaste a identidade antes de associar a ficha.");
            AgendaRules.ValidateOccupation(data, request.StartsAt, request.EndsAt, now, excludingGuestId: request.Id);
            if (!data.Services.Any(x => x.Id == request.Service.Id && x.Active)) throw new IdentityProblem(409, "O serviço deixou de estar disponível. Revê o pedido antes de continuar.");
            var id = Guid.NewGuid().ToString("D");
            var consultation = new Consultation { Id = id, PersonId = input.PersonId!, Service = request.Service,
                StartsAt = request.StartsAt, EndsAt = request.EndsAt, CreatedAt = request.CreatedAt };
            next = request with { State = "Linked", PersonId = input.PersonId, ConsultationId = id };
            // Remove the provisional occupation before confirming the same interval.
            data.GuestRequests[index] = next;
            data.Consultations.Add(ConsultationRules.Approve(data, consultation, input.Choice ?? request.Service.PaymentMode, actor, now));
        }
        else throw new IdentityProblem(400, "Ação inválida para este pedido.");
        data.GuestRequests[index] = next with { Version = request.Version + 1,
            History = [..request.History ?? [], new(input.Action, actor.AccountId, now, next.PersonId)] };
        return new(next.ConsultationId ?? request.Id, input.Action == "LinkGuestRequest" ? "Pedido aprovado e marcação confirmada." : "Pedido atualizado.");
    }
}
