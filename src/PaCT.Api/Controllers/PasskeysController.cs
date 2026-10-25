using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using PaCT.Api.Identity;

namespace PaCT.Api.Controllers;

public sealed record PasskeyEnrollmentOptions(string Password);

[ApiController, Route("api/identity/passkeys"), ServiceFilter(typeof(ApiAntiforgeryFilter))]
[RequestSizeLimit(65536), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PasskeysController(IIdentityStore store, IPasskeyStore credentials, PasskeyService passkeys, IdentityService identity, IdentityCookies cookies) : ControllerBase
{
    private const string BindingCookie = "__Host-PaCT.PasskeyCeremony";
    private async Task<IdentityAccount?> SignedIn(CancellationToken ct)
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (User.Identity?.IsAuthenticated != true || id is null) return null;
        var account = await store.FindAsync(id, ct); return account?.Id == id ? account : null;
    }
    private string NewBinding()
    {
        var value = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        Response.Cookies.Append(BindingCookie, value, IdentityCookies.Options(TimeSpan.FromMinutes(5))); return value;
    }
    private string Binding() => Request.Cookies[BindingCookie] ?? "";
    private IActionResult Expired() => Unauthorized(new ProblemDetails { Status = 401, Title = "Inicia sessão com a palavra-passe antes de continuar a verificação da Passkey." });

    private async Task<IdentityAccount?> EnrollmentAccount(CancellationToken ct)
    {
        var signed = await SignedIn(ct);
        if (signed is not null) return signed;
        var pending = await identity.PendingAccountAsync(cookies.ReadPending(HttpContext), ct);
        // A password-only pending proof must never replace a previously protected account's factor.
        return pending is { EmailConfirmedAt: not null, PasswordHash: not null, PasskeyEnabledAt: null,
            TwoFactorEnabledAt: null, AuthenticatorSecret: null } ? pending : null;
    }

    [HttpPost("registration/options"), EnableRateLimiting("account")]
    public async Task<IActionResult> RegisterOptions(PasskeyEnrollmentOptions input, CancellationToken ct)
    {
        var account = await EnrollmentAccount(ct); if (account is null) return Expired();
        if (!await identity.VerifyCurrentPasswordAsync(account, input.Password, ct)) return Problem(statusCode: 401, title: "Não foi possível confirmar a palavra-passe desta conta.");
        var result = await passkeys.RegistrationOptions(account, NewBinding(), ct);
        return Ok(new { challengeId = result.Id, publicKey = result.Options });
    }
    [HttpPost("registration/finish"), EnableRateLimiting("account")]
    public async Task<IActionResult> RegisterFinish(PasskeyRegistration input, CancellationToken ct)
    {
        var account = await EnrollmentAccount(ct); if (account is null) return Expired();
        await passkeys.Register(account, Binding(), input, ct);
        var updated = await store.FindAsync(account.Id, ct); if (updated?.Id != account.Id) return Expired();
        if (updated.PasswordSignInRequired && cookies.ReadPending(HttpContext)?.Method == "Password")
        {
            await identity.CompleteTrustedSignInAsync(updated, ct);
            updated = await store.FindAsync(updated.Id, ct); if (updated is null) return Expired();
        }
        await cookies.SignInAsync(HttpContext, updated, input.RememberDevice);
        Response.Cookies.Delete(BindingCookie, IdentityCookies.Options(TimeSpan.Zero));
        return Ok(new { stage = "SignedIn", message = "Passkey adicionada à tua conta." });
    }
    [HttpPost("assertion/options"), EnableRateLimiting("identity")]
    public async Task<IActionResult> AssertOptions(CancellationToken ct)
    {
        var account = await identity.PendingAccountAsync(cookies.ReadPending(HttpContext), ct); if (account is null) return Expired();
        var result = await passkeys.AssertionOptions(account, NewBinding(), ct);
        return Ok(new { challengeId = result.Id, publicKey = result.Options });
    }
    [HttpPost("assertion/finish"), EnableRateLimiting("identity")]
    public async Task<IActionResult> AssertFinish(PasskeyAssertion input, CancellationToken ct)
    {
        var account = await identity.PendingAccountAsync(cookies.ReadPending(HttpContext), ct); if (account is null) return Expired();
        try { await passkeys.Assert(account, Binding(), input, ct); }
        catch (IdentityProblem error) when (error.Status == 400) { await identity.RecordFailedPasskeyAsync(account, ct); throw; }
        var updated = await store.FindAsync(account.Id, ct); if (updated?.Id != account.Id) return Expired();
        var method = cookies.ReadPending(HttpContext)?.Method ?? "Password";
        if (updated.PasswordSignInRequired && method == "Password")
        {
            await identity.CompleteTrustedSignInAsync(updated, ct);
            updated = await store.FindAsync(updated.Id, ct); if (updated is null) return Expired();
        }
        await cookies.SignInAsync(HttpContext, updated, input.RememberDevice, method: method);
        Response.Cookies.Delete(BindingCookie, IdentityCookies.Options(TimeSpan.Zero));
        return Ok(new { stage = "SignedIn" });
    }
    [Authorize, HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var account = await SignedIn(ct); if (account is null) return Expired();
        return Ok((await credentials.ListAsync(account.Id, ct)).Select(k => new { k.Name, k.CreatedAt, k.LastUsedAt }));
    }
}
