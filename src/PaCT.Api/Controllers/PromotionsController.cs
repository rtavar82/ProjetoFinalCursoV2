using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PaCT.Api.Consultations;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/consultations/promotions"), AllowAnonymous]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PromotionsController(IConsultationStore store, TimeProvider time) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) => Ok(await store.ReadAgendaAsync(data => new
    {
        packs = data.Services.Where(s => s.Active && s.ServiceKind != "Retreat" && s.PaymentMode != "Free" && !SharingWorkshop.Matches(s.Title) && s.Presentation?.PackPromotionPublished == true && !string.IsNullOrWhiteSpace(s.Presentation?.PackPromotion))
            .Select(s => new { s.Id, s.Title, text = s.Presentation!.PackPromotion }).ToArray(),
        events = data.Events.Where(e => e.Definition.Promoted && e.Definition.Published && e.State == "Scheduled" && e.Definition.StartsAt > time.GetUtcNow())
            .OrderBy(e => e.Definition.StartsAt).Select(e => new { e.Id, serviceId = e.Service.Id, e.Service.Title,
                text = e.Definition.PromotionText, e.Definition.Program, e.Definition.StartsAt, e.Definition.EndsAt, e.Definition.PublicLocation,
                price = e.Service.ServiceKind == "Retreat" ? RetreatFinance.Price(e) : e.Service.ReferencePrice,
                e.Service.PaymentMode, isFree = GroupEvents.IsFree(e.Service) }).ToArray()
    }, ct));
}
