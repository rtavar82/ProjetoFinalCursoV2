using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/management/google-calendar"), Authorize(Roles = Roles.Managers)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class GoogleCalendarController(GoogleCalendarSettings settings, GoogleCalendarAvailability availability, IIdentityStore accounts,
    IConsultationStore consultations, TimeProvider time) : ControllerBase
{
    [HttpGet("occupation")]
    public async Task<IActionResult> Occupation(string? month, CancellationToken ct)
    {
        if (await ActiveManagerAsync(ct) is null) return Forbid();
        var now = time.GetUtcNow();
        var (start, end) = AgendaRules.MonthRange(month, now);
        var pact = await consultations.ReadAgendaAsync(data => ManagementAgendaOccupation.Pact(data, start, end, now), ct);
        var google = await availability.ReadOccupationAsync(start, end, ct);
        return Ok(new
        {
            serverTime = now, startsAt = start, endsAt = end, horizonEndExclusive = AgendaRules.HorizonEndExclusive(now),
            blocks = ManagementAgendaOccupation.Combine(pact, google, start, end),
            settings.Configured, google.Snapshot.Connected, google.Snapshot.Unavailable, google.Snapshot.NeedsReconnect,
            google.TitlesUnavailable, google.NeedsTitlePermission
        });
    }

    [HttpGet]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
        await availability.RefreshAsync(ct);
        var state = availability.Current;
        return Ok(new { settings.Configured, state.Connected, state.Unavailable, state.CheckedAt,
            state.FamilyIncluded, state.NeedsReconnect, state.PublishedAt, state.PublicationUnavailable });
    }

    [HttpPost("connect")]
    public async Task<IActionResult> Connect(CancellationToken ct)
    {
        if (!settings.Configured) throw new IdentityProblem(503, "Falta configurar a ligação ao Google Calendar nesta instalação.");
        var account = await ActiveManagerAsync(ct);
        if (account is null) return Forbid();
        return Challenge(new AuthenticationProperties(new Dictionary<string, string?>
        {
            ["account"] = account.Id, ["stamp"] = account.SecurityStamp
        }), GoogleCalendarAuthorization.Scheme);
    }

    private async Task<IdentityAccount?> ActiveManagerAsync(CancellationToken ct)
    {
        var account = await accounts.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, ct);
        return account is { PersonActive: true, ClosedAt: null, LinkStatus: "Verified" } && Roles.IsManager(account.Role) ? account : null;
    }
}
