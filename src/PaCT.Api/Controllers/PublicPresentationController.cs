using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PaCT.Api.Consultations;
using PaCT.Api.Management;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/public/presentation"), AllowAnonymous]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PublicPresentationController(IConsultationStore store, MySqlSitePresentationStore presentation, SitePresentationImages images) : ControllerBase
{
    [HttpGet("images/{key}/{reference}")]
    public async Task<IActionResult> Image(string key, string reference, CancellationToken ct)
    {
        var file = images.PublishedFile(await presentation.PublishedAsync(ct), key, reference);
        return file is { } published ? PhysicalFile(published.Path, published.Type) : NotFound();
    }

    [HttpGet]
    public async Task<IActionResult> Read(CancellationToken ct)
    {
        var fallback = await presentation.PublishedAsync(ct);
        return Ok(await store.ReadAgendaAsync(data =>
        {
            var published = data.PublishedSite.Version >= fallback.Version ? data.PublishedSite : fallback;
            var places = SiteLocations.PhysicalNames(data, published)
                .Select(name => new PublicPresentationContent.PublicPlace(name, "InPerson", SitePresentation.LocationDescription(published, "InPerson", name)))
                .Append(new(SiteLocations.Online, "Remote", SitePresentation.LocationDescription(published, "Remote", "")));
            return new
            {
                home = SitePresentation.PublicHome(published),
                therapist = SitePresentation.PublicTherapist(published),
                paymentInformation = SitePresentation.PublicPayment(published),
                locations = places.ToArray(),
                experiences = PublicPresentationContent.Experiences,
                experiencePresentations = PublicExperienceContent.Presentations,
                services = ActivityCatalogue.Complete(data.Services).Where(s => s.Active).OrderBy(s => s.Title).ThenBy(s => s.Id).Select(s => new
                {
                    s.Id, s.Version, s.Title, s.ServiceKind, s.DefinedPerEvent,
                    presentation = SafePresentation(s),
                    packOffer = PublicExperienceContent.OffersNegotiatedPack(s) ? PublicExperienceContent.NegotiatedPack : null,
                    options = ClientBooking.Options(s, published).Select(option =>
                    {
                        var chosen = ClientBooking.Snapshot(s, option);
                        return new { option.Id, chosen.Modality, chosen.PublicLocation,
                            locationDescription = SitePresentation.LocationDescription(published, chosen.Modality, chosen.PublicLocation),
                            chosen.DurationMinutes, chosen.ReferencePrice, chosen.PaymentMode,
                            packTotal = (decimal?)null };
                    }).ToArray()
                }).ToArray(),
                packPolicy = new { validityMonths = PackPolicy.ValidityMonths, reminderMonthsBeforeExpiry = PackPolicy.ReminderMonthsBeforeExpiry }
            };
        }, ct));
    }
    private static ServicePresentation? SafePresentation(ConsultationService service)
    {
        var text = service.Presentation ?? PublicPresentationContent.ServiceText(service.Title);
        return text is null ? null : new(text.Introduction, text.Description, text.Recommendations, text.PackSessions);
    }
}
