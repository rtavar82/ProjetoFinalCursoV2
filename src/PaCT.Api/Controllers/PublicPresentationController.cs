using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PaCT.Api.Consultations;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/public/presentation"), AllowAnonymous]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PublicPresentationController(IConsultationStore store) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Read(CancellationToken ct) => Ok(await store.ReadAgendaAsync(data => new
    {
        therapist = PublicPresentationContent.Therapist,
        paymentInformation = PublicPresentationContent.PaymentInformation,
        locations = PublicPresentationContent.Places.Concat(data.Services.Where(s => s.Active).SelectMany(ClientBooking.Options)
            .Select(o => new PublicPresentationContent.PublicPlace(o.Modality == "Remote" ? "Online" : o.PublicLocation, o.Modality,
                PublicPresentationContent.LocationDescription(o.Modality, o.PublicLocation)))).DistinctBy(p => (p.Name, p.Modality)).ToArray(),
        experiences = PublicPresentationContent.Experiences,
        experiencePresentations = PublicExperienceContent.Presentations,
        services = ActivityCatalogue.Complete(data.Services).Where(s => s.Active).OrderBy(s => s.Title).ThenBy(s => s.Id).Select(s => new
        {
            s.Id, s.Version, s.Title, s.ServiceKind, s.DefinedPerEvent,
            presentation = SafePresentation(s),
            packOffer = PublicExperienceContent.IsSentir(s.Title) ? PublicExperienceContent.NegotiatedPack : null,
            options = ClientBooking.Options(s).Select(option =>
            {
                var chosen = ClientBooking.Snapshot(s, option);
                return new { option.Id, chosen.Modality, chosen.PublicLocation,
                    locationDescription = PublicPresentationContent.LocationDescription(chosen.Modality, chosen.PublicLocation),
                    chosen.DurationMinutes, chosen.ReferencePrice, chosen.PaymentMode,
                    packTotal = (decimal?)null };
            }).ToArray()
        }).ToArray(),
        packPolicy = new { validityMonths = PackPolicy.ValidityMonths, reminderMonthsBeforeExpiry = PackPolicy.ReminderMonthsBeforeExpiry }
    }, ct));
    private static ServicePresentation? SafePresentation(ConsultationService service)
    {
        var text = service.Presentation ?? PublicPresentationContent.ServiceText(service.Title);
        return text is null ? null : new(text.Introduction, text.Description, text.Recommendations, text.PackSessions);
    }
}
