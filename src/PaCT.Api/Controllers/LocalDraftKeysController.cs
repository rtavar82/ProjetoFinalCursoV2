using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;

namespace PaCT.Api.Controllers;

public sealed record LocalDraftKeyRequest(string? SealedKey);

[ApiController, Route("api/identity/local-draft-key"), Authorize]
[RequestSizeLimit(8192), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class LocalDraftKeysController(IDataProtectionProvider protection) : ControllerBase
{
    [HttpPost]
    public IActionResult Unlock(LocalDraftKeyRequest input)
    {
        var owner = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var protector = protection.CreateProtector("PaCT0.2.LocalDraftKey.v1", owner);
        byte[] key;
        string sealedKey;
        if (input.SealedKey is null)
        {
            key = RandomNumberGenerator.GetBytes(32);
            sealedKey = Convert.ToBase64String(protector.Protect(key));
        }
        else
        {
            if (input.SealedKey.Length is 0 or > 4096) return InvalidEnvelope();
            try
            {
                key = protector.Unprotect(Convert.FromBase64String(input.SealedKey));
                if (key.Length != 32) { CryptographicOperations.ZeroMemory(key); return InvalidEnvelope(); }
                sealedKey = input.SealedKey;
            }
            catch (Exception error) when (error is CryptographicException or FormatException) { return InvalidEnvelope(); }
        }
        try { return Ok(new { owner, sealedKey, key = Convert.ToBase64String(key) }); }
        finally { CryptographicOperations.ZeroMemory(key); }
    }

    private IActionResult InvalidEnvelope() => BadRequest(new ProblemDetails
    {
        Status = 400, Title = "Não foi possível desbloquear estes rascunhos para esta conta. Os dados locais foram preservados."
    });
}
