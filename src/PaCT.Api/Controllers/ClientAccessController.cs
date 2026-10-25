using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using PaCT.Api.Identity;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/clients/{personId:guid}/access"), Authorize(Roles = Roles.Managers)]
[RequestSizeLimit(8192), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ClientAccessController(ClientAccessService access) : ControllerBase
{
    private string Author => User.FindFirstValue(ClaimTypes.NameIdentifier)!;
    [HttpGet] public async Task<IActionResult> Status(string personId, CancellationToken ct) => Ok(await access.StatusAsync(personId, Author, ct));
    [HttpPost("email"), EnableRateLimiting("account")] public async Task<IActionResult> Email(string personId, ClientAccessRequest input, CancellationToken ct) => Ok(await access.RequestAsync(personId, Author, input, false, ct));
    [HttpPost("reset-passkeys"), EnableRateLimiting("account")] public async Task<IActionResult> Reset(string personId, ClientAccessRequest input, CancellationToken ct) => Ok(await access.RequestAsync(personId, Author, input, true, ct));
}

[ApiController, Route("api/identity/confirm-access-email")]
[RequestSizeLimit(16384), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ClientAccessConfirmationController(ClientAccessService access) : ControllerBase
{
    [HttpPost, EnableRateLimiting("account")] public async Task<IActionResult> Confirm(EmailConfirmation input, CancellationToken ct)
    {
        if (User.Identity?.IsAuthenticated == true)
            return Conflict(new ProblemDetails { Status = 409, Title = "Termina a sessão atual ou abre o link numa janela privada para confirmar o novo email." });
        await access.ConfirmEmailAsync(input.Token, ct);
        return Ok(new { message = "Email confirmado. Já podes entrar com o novo email e a tua palavra-passe habitual." });
    }
}
