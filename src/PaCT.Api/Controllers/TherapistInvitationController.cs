using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using PaCT.Api.Identity;
using System.Security.Claims;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/identity"), RequestSizeLimit(32768)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class TherapistInvitationController(TherapistInvitationService service, IdentityCookies cookies) : ControllerBase
{
    [Authorize(Roles = Roles.Managers), HttpGet("therapist-management")]
    public async Task<IActionResult> Management(CancellationToken ct) => Ok(await service.ManagementAsync(ct));

    [Authorize(Roles = Roles.TechnicalManager), HttpPost("therapist-invitations"), EnableRateLimiting("email")]
    public async Task<IActionResult> Invite(TherapistInvitationRequest input, CancellationToken ct)
    {
        await service.CreateAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, input, ct);
        return Ok(new { message = "Convite guardado e colocado na fila de envio. É válido durante 24 horas. Um convite anterior foi substituído, se existia." });
    }

    [Authorize(Roles = Roles.TechnicalManager), HttpPost("therapist-invitations/{id}/cancel"), EnableRateLimiting("account")]
    public async Task<IActionResult> Cancel(string id, CancellationToken ct) =>
        await service.CancelAsync(id, User.FindFirstValue(ClaimTypes.NameIdentifier)!, ct)
            ? Ok(new { message = "Convite cancelado. O link deixou de ser válido." })
            : Conflict(new ProblemDetails { Status = 409, Title = "O convite mudou ou já foi utilizado. Atualiza a informação." });

    [HttpPost("therapist-invitation/preview"), EnableRateLimiting("account")]
    public async Task<IActionResult> Preview(InvitationPreviewRequest input, CancellationToken ct)
    {
        var invitation = await service.ValidInvitationAsync(input.Token, ct);
        return invitation is null ? InvalidInvitation() : Ok(service.Preview(invitation));
    }

    [HttpPost("therapist-registration"), EnableRateLimiting("email")]
    public async Task<IActionResult> Register(TherapistRegistration input, CancellationToken ct)
    {
        if (User.Identity?.IsAuthenticated == true) return Conflict(new ProblemDetails
        {
            Status = 409, Title = "Já existe uma sessão iniciada neste navegador. Termina-a ou abre o convite numa janela privada para criar a conta da terapeuta."
        });
        if (IdentityValidation.MissingNameMessage(input.FirstName, input.LastName) is { } missingName)
            return Problem(statusCode: 400, title: missingName);
        var invitation = await service.ValidInvitationAsync(input.Token, ct);
        if (invitation is null) return InvalidInvitation();
        var account = await service.RegisterAsync(invitation, input, ct);
        cookies.SetPending(HttpContext, account);
        return Ok(new { stage = "ConfirmEmail", message = "Conta da gestora-terapeuta criada. Confirma o teu email e configura a Passkey para entrar na gestão." });
    }

    private IActionResult InvalidInvitation() => BadRequest(new ProblemDetails
    {
        Status = 400, Title = "Este convite expirou, foi cancelado, já foi utilizado ou não é válido. Pede um novo convite ao gestor técnico."
    });
}
