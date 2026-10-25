using PaCT.Api.Identity;
using System.Text.Json.Serialization;

namespace PaCT.Api.Consultations;

public sealed record ManualBookingInput(string PersonId, string ServiceId, long ServiceVersion, string? DeliveryOptionId,
    [property: JsonConverter(typeof(ExplicitInstantConverter))] DateTimeOffset StartsAt, int DurationMinutes, string? Choice = null);
public sealed record ManualBookingConflict(string Id, long Version, string Kind, DateTimeOffset StartsAt, DateTimeOffset EndsAt);
public sealed record ManualBookingReview(string Revision, string ServiceId, long ServiceVersion, string? DeliveryOptionId,
    string Title, string Modality, string PublicLocation, int DurationMinutes, decimal? ReferencePrice, string PaymentMode,
    DateTimeOffset StartsAt, DateTimeOffset EndsAt, bool CanConfirm, bool CanOverrideBlock, ManualBookingConflict[] Conflicts);

public static class ManualBooking
{
    public static ConsultationService Resolve(ConsultationData data, string? serviceId, long? version, string? optionId, int? duration)
    {
        var source = data.Services.SingleOrDefault(s => s.Id == serviceId && s.Active && s.ServiceKind is null)
            ?? throw new IdentityProblem(400, "Seleciona uma consulta individual ativa.");
        if (version is not null && version != source.Version) throw new IdentityProblem(409, "A consulta mudou. Revê as opções atuais.");
        var options = ClientBooking.Options(source);
        var option = optionId is null && options.Length == 1 ? options[0] : options.SingleOrDefault(o => o.Id == optionId)
            ?? throw new IdentityProblem(400, "Seleciona a modalidade e o local da consulta.");
        var service = ClientBooking.Snapshot(source, option);
        if (duration is not null)
        {
            if (duration is < 1 or > 10080) throw new IdentityProblem(400, "Indica uma duração acordada válida, entre 1 e 10080 minutos.");
            service = service with { DurationMinutes = duration.Value };
        }
        return service;
    }
    public static ManualBookingReview Preview(ConsultationData data, ManualBookingInput input, DateTimeOffset now)
    {
        if (!Guid.TryParse(input.PersonId, out _) || input.ServiceVersion < 1) throw new IdentityProblem(400, "Seleciona uma ficha e as opções atuais da consulta.");
        var service = Resolve(data, input.ServiceId, input.ServiceVersion, input.DeliveryOptionId, input.DurationMinutes);
        var start = input.StartsAt.ToUniversalTime(); var end = start.AddMinutes(service.DurationMinutes);
        if (!AgendaRules.IsBookableStart(start, now)) throw new IdentityProblem(400, "Escolhe um início futuro dentro dos próximos seis meses.");
        ConsultationRules.ValidateFinancialChoice(data, service, input.PersonId, input.Choice ?? service.PaymentMode);
        var conflicts = data.Consultations.Where(c => ConsultationRules.Occupies(c, now) && AgendaRules.Overlaps(start, end.AddMinutes(30), c.StartsAt, c.EndsAt.AddMinutes(30)))
            .Select(c => new ManualBookingConflict(c.Id, c.Version, c.KeepBlocked ? "Protected" : "Consultation", c.StartsAt, c.EndsAt.AddMinutes(30)))
            .Concat(data.GuestRequests.Where(g => GuestConsultations.Occupies(g, now) && AgendaRules.Overlaps(start, end.AddMinutes(30), g.StartsAt, g.EndsAt.AddMinutes(30)))
                .Select(g => new ManualBookingConflict(g.Id, g.Version, "Guest", g.StartsAt, g.EndsAt.AddMinutes(30))))
            .Concat(data.Events.Where(e => GroupEvents.Occupies(e) && AgendaRules.Overlaps(start, end.AddMinutes(30), e.Definition.StartsAt, e.Definition.EndsAt.AddMinutes(30)))
                .Select(e => new ManualBookingConflict(e.Id, e.Version, e.KeepBlocked ? "Protected" : "Event", e.Definition.StartsAt, e.Definition.EndsAt.AddMinutes(30))))
            .Concat(AgendaRules.ActiveWindows(data).Where(w => !w.Available && AgendaRules.Overlaps(start, end.AddMinutes(30), w.StartsAt, w.EndsAt))
                .Select(w => new ManualBookingConflict(w.Id, w.Version, "Block", w.StartsAt, w.EndsAt))).OrderBy(c => c.StartsAt).ThenBy(c => c.Id).ToArray();
        return new(AgendaRules.Revision(data), service.Id, service.Version, input.DeliveryOptionId, service.Title, service.Modality,
            service.PublicLocation, service.DurationMinutes, service.ReferencePrice, service.PaymentMode, start, end,
            conflicts.Length == 0, conflicts.Length == 1 && conflicts[0].Kind == "Block", conflicts);
    }
}
