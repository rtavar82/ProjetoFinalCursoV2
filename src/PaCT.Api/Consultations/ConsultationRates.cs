using PaCT.Api.Identity;
using PaCT.Api.Management;

namespace PaCT.Api.Consultations;

public sealed record DeliveryRate(string Id, int? DurationMinutes, decimal? ReferencePrice);
public sealed record ConsultationRate(int DurationMinutes, decimal? ReferencePrice, DeliveryRate[] Options);
public sealed record CatalogueConsultationEdit(string Title, string Description, string Introduction, string Recommendations,
    ConsultationRate Rates, string? PaymentMode = null, bool InPerson = false, bool Remote = false);

internal static class ConsultationRates
{
    public static ConsultationService Edit(ConsultationData data, ConsultationService? existing, CatalogueConsultationEdit input)
    {
        var title = IdentityValidation.Required(input.Title, 200, "o nome da consulta");
        if (data.Services.Any(service => service.Id != existing?.Id && service.Active
            && string.Equals(service.Title.Trim(), title, StringComparison.OrdinalIgnoreCase)))
            throw new IdentityProblem(409, "Já existe uma consulta ou atividade com esse nome.");
        var description = input.Description?.Trim() ?? "";
        if (description.Length == 0) throw new IdentityProblem(400, "Indica a descrição pública da consulta.");
        var rates = input.Rates ?? throw new IdentityProblem(400, "Indica a duração e o preço.");
        if (existing is not null)
        {
            var current = existing.Presentation ?? PublicPresentationContent.ServiceText(existing.Title) ?? new("", "");
            return Update(existing, rates) with
            {
                Title = title,
                Presentation = current with
                {
                    Introduction = input.Introduction?.Trim() ?? "", Description = description, Recommendations = input.Recommendations?.Trim() ?? "",
                    NegotiatedPackOffer = PublicExperienceContent.OffersNegotiatedPack(existing)
                }
            };
        }

        if (input.PaymentMode is not ("Prepayment" or "Postpayment" or "Contribution" or "Free") || !input.InPerson && !input.Remote)
            throw new IdentityProblem(400, "Escolhe o pagamento e pelo menos uma modalidade da consulta.");
        var physical = input.InPerson ? SiteLocations.Published(data.PublishedSite).FirstOrDefault()
            ?? throw new IdentityProblem(400, "Publica primeiro um local para disponibilizar consultas presenciais.") : null;
        var options = new List<ConsultationDelivery>();
        if (input.Remote) options.Add(new("online", "Remote", "", ""));
        if (physical is not null && !input.Remote) options.Add(new("standard", "InPerson", physical.Name, ""));
        return new("", title, rates.DurationMinutes, rates.ReferencePrice, input.PaymentMode,
            input.Remote ? "Remote" : "InPerson", input.Remote ? "" : physical!.Name, "",
            BookingOptions: options.ToArray(), Presentation: new(input.Introduction?.Trim() ?? "", description,
                input.Recommendations?.Trim() ?? "", NegotiatedPackOffer: false),
            OffersAtManagedLocations: input.InPerson);
    }

    public static ConsultationService Update(ConsultationService service, ConsultationRate rates)
    {
        var options = service.BookingOptions ?? [];
        if (rates.Options is null || rates.Options.Length != options.Length || rates.Options.Any(option => string.IsNullOrWhiteSpace(option?.Id))
            || rates.Options.Select(option => option.Id).Distinct(StringComparer.Ordinal).Count() != options.Length)
            throw new IdentityProblem(400, "Revê as modalidades e os locais da consulta.");
        var values = rates.Options.ToDictionary(option => option.Id, StringComparer.Ordinal);
        return service with
        {
            DurationMinutes = rates.DurationMinutes,
            ReferencePrice = IsPriced(service.PaymentMode) ? rates.ReferencePrice : service.ReferencePrice,
            BookingOptions = service.BookingOptions?.Select(option =>
            {
                if (!values.TryGetValue(option.Id, out var value)) throw new IdentityProblem(400, "Revê as opções da consulta.");
                return option with
                {
                    DurationMinutes = value.DurationMinutes,
                    ReferencePrice = IsPriced(option.PaymentMode ?? service.PaymentMode) ? value.ReferencePrice : option.ReferencePrice
                };
            }).ToArray()
        };
    }

    internal static bool IsPriced(string paymentMode) => paymentMode is "Prepayment" or "Postpayment";
}
