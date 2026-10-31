using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using PaCT.Api.Identity;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/identity/manager-recovery-key"), Authorize(Roles = Roles.Managers)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ManagerRecoveryController(IDataProtectionProvider protection) : ControllerBase
{
    public sealed record RecoveryKeyRequest(string WindowId, string? Envelope);

    // This endpoint protects a per-window encryption key only. It receives no
    // form content and writes no account, consultation or database record.
    [HttpPost, RequestSizeLimit(8192)]
    public IActionResult Key(RecoveryKeyRequest input)
    {
        if (!Guid.TryParse(input.WindowId, out var windowId) || input.Envelope?.Length > 4096)
            return BadRequest(new ProblemDetails { Title = "Não foi possível preparar a proteção temporária desta janela." });
        var owner = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var protector = protection.CreateProtector("PaCT.ManagerInterruption.v1", owner, windowId.ToString("D"));
        try
        {
            var key = input.Envelope is null ? Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) : protector.Unprotect(input.Envelope);
            if (Convert.FromBase64String(key).Length != 32) throw new CryptographicException();
            return Ok(new { key, envelope = input.Envelope ?? protector.Protect(key) });
        }
        catch (Exception error) when (error is CryptographicException or FormatException)
        {
            return BadRequest(new ProblemDetails { Title = "Não foi possível abrir a proteção temporária desta conta e janela." });
        }
    }
}
