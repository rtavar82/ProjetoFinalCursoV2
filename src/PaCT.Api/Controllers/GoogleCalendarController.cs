using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/management/google-calendar"), Authorize(Roles = Roles.Managers)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class GoogleCalendarController(GoogleCalendarSettings settings, GoogleCalendarAvailability availability, IIdentityStore accounts) : ControllerBase
{
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
        var account = await accounts.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, ct);
        if (account is not { PersonActive: true, ClosedAt: null, LinkStatus: "Verified" } || !Roles.IsManager(account.Role)) return Forbid();
        return Challenge(new AuthenticationProperties(new Dictionary<string, string?>
        {
            ["account"] = account.Id, ["stamp"] = account.SecurityStamp
        }), GoogleCalendarAuthorization.Scheme);
    }
}
