using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/consultations/packs"), Authorize(Roles = Roles.ManagersAndClient)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class SessionPacksController(IConsultationStore store, IIdentityStore accounts, TimeProvider time, IdentitySecurity security) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(string? personId = null, string scope = "Available", int page = 1, string? serviceId = null, DateTimeOffset? at = null, CancellationToken ct = default)
    {
        var account = await accounts.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, ct) ?? throw new IdentityProblem(401, "Inicia sessão novamente.");
        var manager = Roles.IsManager(account.Role); var person = manager ? personId : account.PersonId; var now = time.GetUtcNow();
        if (scope is not ("Available" or "Unpaid" or "History" or "Compatible") || page is < 1 or > 100000 || person is not null && !Guid.TryParse(person, out _)
            || scope == "Compatible" && (!manager || person is null || !Guid.TryParse(serviceId, out _) || at is null || at > now)) return Problem(statusCode: 400, title: "Pesquisa de packs inválida.");
        return Ok(await store.ReadAsync(data =>
        {
            var rows = data.Packs.Where(p => person is null || p.PersonId == person)
                .Where(p => scope == "History" || scope == "Unpaid" && p.SettlementId is null || scope == "Available" && p.SettlementId is not null && SessionPacks.Remaining(data, p.Id) > 0
                    || scope == "Compatible" && SessionPacks.CanUse(data, p, serviceId!, at!.Value))
                .OrderBy(p => SessionPacks.ExpiresAt(p)).ThenBy(p => p.Id).ToArray();
            return new { total = rows.Length, page, pageSize = 8, items = rows.Skip((page - 1) * 8).Take(8).Select(p => View(p, data, manager)).ToArray() };
        }, ct));
    }
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Detail(string id, CancellationToken ct)
    {
        var account = await accounts.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, ct) ?? throw new IdentityProblem(401, "Inicia sessão novamente.");
        var manager = Roles.IsManager(account.Role);
        return Ok(await store.ReadAsync(data => View(data.Packs.SingleOrDefault(p => p.Id == id && (manager || p.PersonId == account.PersonId))
            ?? throw new IdentityProblem(404, "Pack não encontrado."), data, manager), ct));
    }
    private object View(SessionPack pack, ConsultationData data, bool manager) => new
    {
        pack.Id, pack.PersonId, pack.Version, pack.Title, pack.Sessions, pack.Amount, pack.PurchasedAt, pack.ServiceIds,
        expiresAt = SessionPacks.ExpiresAt(pack), remaining = SessionPacks.Remaining(data, pack.Id), pack.EarlyUseAuthorized, pack.SettlementId,
        pack.ExtensionMonths, pack.ValidUntil, pack.RegularTotal, balance = data.Balance(pack.PersonId),
        decisions = (pack.History ?? []).Select(h => new { h.Action, h.At, h.Quantity, h.NewValidity }).ToArray(),
        uses = data.PackUses.Where(u => u.PackId == pack.Id).Select(u => new { u.Id, u.ActivityId, u.ActivityKind, u.ActivityAt, u.CreatedAt, u.ReversesId,
            reversed = data.PackUses.Any(r => r.ReversesId == u.Id) }).ToArray(),
        history = manager ? (pack.History ?? []).Select(h => new { h.Action, h.AuthorId, h.At, h.PreviousMonths, h.NewMonths,
            h.Quantity, h.PreviousValidity, h.NewValidity,
            reason = h.ReasonCiphertext is null ? null : security.Decrypt(pack.Id, "consultation-pack-reason", Convert.FromBase64String(h.ReasonCiphertext)) }).ToArray() : []
    };
}
