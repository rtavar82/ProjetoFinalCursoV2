using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public static class ClientBooking
{
    public static ConsultationDelivery[] Options(ConsultationService service) => service.BookingOptions
        ?? [new("standard", service.Modality, service.Modality == "Remote" ? "" : service.PublicLocation, service.Instructions)];
    public static ConsultationService Snapshot(ConsultationService service, ConsultationDelivery option) => service with
    {
        Modality = option.Modality, PublicLocation = option.PublicLocation, Instructions = option.Instructions, BookingOptions = null,
        PromotionHistory = null, Presentation = service.Presentation is null ? null : service.Presentation with { PackPromotion = null, PackPromotionPublished = false },
        DurationMinutes = option.DurationMinutes ?? service.DurationMinutes, PaymentMode = option.PaymentMode ?? service.PaymentMode,
        ReferencePrice = (option.PaymentMode ?? service.PaymentMode) == "Free" ? 0 : (option.PaymentMode ?? service.PaymentMode) == "Contribution" ? null : option.ReferencePrice ?? service.ReferencePrice
    };

    public static void ValidateOptions(ConsultationService service)
    {
        if (service.BookingOptions is null) return;
        var options = service.BookingOptions;
        if (service.ServiceKind is not null || options.Length is < 1 or > 20 || options.Any(o => o is null)
            || options.Select(o => o.Id).Distinct(StringComparer.Ordinal).Count() != options.Length
            || options.Any(o => string.IsNullOrWhiteSpace(o.Id) || o.Id.Length > 80 || o.Modality is not ("InPerson" or "Remote")
                || o.PublicLocation is null || o.PublicLocation.Length > 300 || o.Instructions is null || o.Instructions.Length > 4000
                || (o.Modality == "InPerson" ? string.IsNullOrWhiteSpace(o.PublicLocation) : o.PublicLocation != "")
                || Snapshot(service, o).DurationMinutes is < 15 or > 720
                || Snapshot(service, o).PaymentMode is not ("Prepayment" or "Postpayment" or "Contribution" or "Free")
                || (Snapshot(service, o).PaymentMode is "Prepayment" or "Postpayment" && (Snapshot(service, o).ReferencePrice is not (> 0 and <= 1000000m) || decimal.Round(Snapshot(service, o).ReferencePrice!.Value, 2) != Snapshot(service, o).ReferencePrice))))
            throw new IdentityProblem(400, "Indica opções de modalidade e local válidas, até 20 por consulta.");
    }

    public static ConsultationService Validate(ConsultationData data, string? serviceId, DateTimeOffset start,
        long? version, string? optionId, DateTimeOffset now, bool registered = true)
    {
        var service = data.Services.SingleOrDefault(s => s.Id == serviceId && s.Active && s.ServiceKind is null)
            ?? throw new IdentityProblem(400, "Esta consulta não está disponível.");
        if (version is not null && service.Version != version) throw new IdentityProblem(409, "As opções desta consulta mudaram. Revê a seleção antes de enviar.");
        var options = Options(service);
        var option = optionId is null && options.Length == 1 ? options[0] : options.SingleOrDefault(o => o.Id == optionId)
            ?? throw new IdentityProblem(400, "Escolhe uma modalidade e um local disponíveis para esta consulta.");
        service = Snapshot(service, option);
        if (!AgendaRules.IsBookableStart(start, now)) throw new IdentityProblem(400, "Escolhe um início futuro dentro dos próximos seis meses.");
        var end = start.AddMinutes(service.DurationMinutes);
        AgendaRules.ValidateOccupation(data, start, end, now);
        if (AgendaRules.ActiveWindows(data).Any(w => !w.Available && AgendaRules.Overlaps(start, end.AddMinutes(30), w.StartsAt, w.EndsAt))
            || !AgendaRules.Allows(data, service, start, end, registered)) throw new IdentityProblem(409, "Este horário já não está disponível para as opções da consulta.");
        return service;
    }
}
