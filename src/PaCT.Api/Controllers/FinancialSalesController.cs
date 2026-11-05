using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/finance/sales"), Authorize(Roles = Roles.ManagersAndClient)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class FinancialSalesController(IConsultationStore store, IIdentityStore accounts, IdentitySecurity security) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(string? personId = null, string? kind = null, DateTimeOffset? from = null,
        DateTimeOffset? to = null, int page = 1, CancellationToken ct = default)
    {
        var actor = await Account(ct);
        if (!Roles.IsManager(actor.Role)) personId = actor.PersonId;
        if (page is < 1 or > 100000 || personId is not null && !Guid.TryParse(personId, out _)
            || kind is not null && !FinancialSales.Kinds.Contains(kind) || from is not null && to is not null && to <= from)
            return Problem(statusCode: 400, title: "Confirma os filtros da pesquisa de vendas.");
        return Ok(await store.ReadAsync(data =>
        {
            Ready(data);
            var rows = data.Sales.Where(s => (personId is null || s.PersonId == personId) && (kind is null || s.Kinds.Contains(kind))
                && (from is null || s.EffectiveAt >= from) && (to is null || s.EffectiveAt < to))
                .OrderByDescending(s => s.EffectiveAt).ThenByDescending(s => s.CreatedAt).ThenBy(s => s.Id).ToArray();
            return new { total = rows.Length, page, pageSize = 8, items = rows.Skip((page - 1) * 8).Take(8).Select(View).ToArray() };
        }, ct));
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Detail(string id, CancellationToken ct)
    {
        var actor = await Account(ct);
        return Ok(await store.ReadAsync(data =>
        {
            Ready(data);
            var sale = data.Sales.SingleOrDefault(s => s.Id == id && (Roles.IsManager(actor.Role) || s.PersonId == actor.PersonId))
                ?? throw new IdentityProblem(404, "Venda não encontrada.");
            return View(sale);
        }, ct));
    }

    private async Task<IdentityAccount> Account(CancellationToken ct) =>
        await accounts.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, ct)
        ?? throw new IdentityProblem(401, "Inicia sessão novamente.");
    private static void Ready(ConsultationData data)
    {
        if (!data.SalesReady) throw new IdentityProblem(503, "Não foi possível abrir as vendas. A preparação desta área ainda não foi concluída.");
    }
    private object View(FinancialSale sale)
    {
        var json = security.Decrypt(sale.Id, "consultation-sale-lines", Convert.FromBase64String(sale.LinesCiphertext));
        var lines = JsonSerializer.Deserialize<SaleLineInput[]>(json)!;
        return new
        {
            sale.Id, sale.PersonId, sale.CreatedAt, sale.EffectiveAt, sale.CreatedBy, sale.Total, sale.Kinds, sale.Payments, sale.PackIds,
            anonymous = sale.PersonId is null, state = "Paid",
            lines = lines.Select(l => new { l.Kind, l.Name, l.Description, l.Quantity, l.UnitPrice, total = l.Quantity * l.UnitPrice,
                l.Weight, l.Size, l.Sessions, l.ServiceIds, l.Modality, l.Location, l.StartsAt, l.EndsAt, l.RegularTotal,
                discountPercent = l.RegularTotal is > 0 ? decimal.Round((1 - l.UnitPrice / l.RegularTotal.Value) * 100, 2) : (decimal?)null }).ToArray()
        };
    }
}
