using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using PaCT.Api.Identity;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/identity/password-change")]
[RequestSizeLimit(16384), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PasswordChangeController(PasswordChangeService passwords) : ControllerBase
{
    [Authorize, HttpPost, EnableRateLimiting("account")]
    public async Task<IActionResult> RequestChange(PasswordChangeRequest input, CancellationToken ct)
    {
        await passwords.RequestAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, input, ct);
        return Ok(new { message = "Pedido recebido. Abre o email da tua conta para escolheres a nova palavra-passe." });
    }
    [HttpPost("confirm"), EnableRateLimiting("account")]
    public async Task<IActionResult> Confirm(PasswordChangeConfirmation input, CancellationToken ct)
    {
        await passwords.ConfirmAsync(input, User.Identity?.IsAuthenticated == true ? User.FindFirstValue(ClaimTypes.NameIdentifier) : null, ct);
        await AccountLoginController.ClearSession(HttpContext);
        return Ok(new { stage = "SignIn", message = "Palavra-passe alterada. Entra novamente com o teu email e a nova palavra-passe." });
    }
}

[ApiController, Route("api/identity/google")]
[RequestSizeLimit(8192), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AccountLoginController(GoogleLoginSettings settings, GoogleFlows flows, GoogleAccountService google,
    PasswordChangeService passwords, IdentityService identity, IdentityCookies cookies) : ControllerBase
{
    [HttpGet("status")]
    public async Task<IActionResult> Status(CancellationToken ct) => User.Identity?.IsAuthenticated == true
        ? Ok(await google.StatusAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, settings.Enabled, ct)) : Ok(new { enabled = settings.Enabled });

    [HttpPost("start"), EnableRateLimiting("identity")]
    public async Task<IActionResult> Start(GoogleStartRequest input, CancellationToken ct)
    {
        settings.Check();
        IdentityAccount? account = null;
        if (input.Mode == "Link")
        {
            if (User.Identity?.IsAuthenticated != true) return Unauthorized();
            account = await passwords.VerifyOwnPassword(User.FindFirstValue(ClaimTypes.NameIdentifier)!, input.Password, ct);
        }
        else if (input.Mode != "SignIn") return BadRequest();
        else if (User.Identity?.IsAuthenticated == true) return Conflict(new ProblemDetails { Status = 409, Title = "Termina a sessão atual antes de iniciares outra entrada." });
        flows.Remove(Request.Cookies[GoogleFlows.Cookie]);
        await HttpContext.SignOutAsync(GoogleAuthentication.ExternalScheme);
        Response.Cookies.Append(GoogleFlows.Cookie, flows.Create(input.Mode, account, Request.Cookies[IdentityCookies.Trusted]), GoogleFlows.Options);
        return Ok(new { url = "/api/identity/google/challenge" });
    }

    [HttpGet("challenge"), EnableRateLimiting("identity")]
    public IActionResult ChallengeGoogle()
    {
        settings.Check();
        var flow = flows.Start(Request.Cookies[GoogleFlows.Cookie]);
        if (flow is null) return Redirect("/#google-result=Failed");
        var properties = new AuthenticationProperties { RedirectUri = "/api/identity/google/complete" };
        properties.Items["flow"] = flow.Id;
        return Challenge(properties, GoogleDefaults.AuthenticationScheme);
    }

    [HttpGet("complete"), EnableRateLimiting("identity")]
    public async Task<IActionResult> Complete(CancellationToken ct)
    {
        var ticket = await HttpContext.AuthenticateAsync(GoogleAuthentication.ExternalScheme);
        var binding = Request.Cookies[GoogleFlows.Cookie];
        var valid = ticket.Succeeded && binding is not null && ticket.Properties?.Items.TryGetValue("flow", out var expected) == true && expected == binding;
        var flow = valid ? flows.Consume(binding) : null;
        await HttpContext.SignOutAsync(GoogleAuthentication.ExternalScheme);
        Response.Cookies.Delete(GoogleFlows.Cookie, GoogleFlows.Options);
        if (flow is null || ticket.Principal is null) return Redirect("/#google-result=Failed");
        try
        {
            var subject = ticket.Principal.FindFirstValue(ClaimTypes.NameIdentifier);
            var email = ticket.Principal.FindFirstValue(ClaimTypes.Email);
            if (subject is null || email is null || !string.Equals(ticket.Principal.FindFirstValue("google_email_verified"), "true", StringComparison.OrdinalIgnoreCase))
                return Redirect("/#google-result=Failed");
            var googleIdentity = new GoogleIdentity(subject, email);
            if (flow.Mode == "Link")
            {
                await google.LinkAsync(flow.AccountId!, flow.Stamp!, googleIdentity, ct);
                return Redirect("/#google-result=Linked");
            }
            var account = await google.ResolveAsync(googleIdentity, ct);
            if (account is null) return Redirect("/#google-result=NotLinked");
            var trustedUntil = cookies.TrustedUntil(flow.TrustedBrowser, account);
            if (account.PasskeyEnabledAt is not null && trustedUntil is null
                || account.TwoFactorEnabledAt is not null && account.PasskeyEnabledAt is null && trustedUntil is null
                || account.Role != Roles.Client && account.TwoFactorEnabledAt is null && account.PasskeyEnabledAt is null)
            {
                cookies.SetPending(HttpContext, account, "Google");
                return Redirect("/#google-result=Continue");
            }
            await identity.CompleteTrustedSignInAsync(account, ct);
            await cookies.SignInAsync(HttpContext, account, false, trustedUntil, "Google");
            return Redirect("/#google-result=Continue");
        }
        catch (IdentityProblem error) { return Redirect("/#google-result=" + (error.Status == 403 ? "PasswordRequired" : error.Status == 409 ? "Conflict" : "Failed")); }
    }

    [Authorize, HttpPost("unlink"), EnableRateLimiting("account")]
    public async Task<IActionResult> Unlink(PasskeyEnrollmentOptions input, CancellationToken ct)
    {
        var account = await passwords.VerifyOwnPassword(User.FindFirstValue(ClaimTypes.NameIdentifier)!, input.Password, ct);
        await google.UnlinkAsync(account.Id, account.SecurityStamp, ct);
        await ClearSession(HttpContext);
        return Ok(new { stage = "SignIn", message = "A conta Google foi desassociada. Entra com o teu email e a palavra-passe." });
    }

    internal static async Task ClearSession(HttpContext context)
    {
        await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        await context.SignOutAsync(GoogleAuthentication.ExternalScheme);
        foreach (var name in new[] { IdentityCookies.Pending, IdentityCookies.Trusted, "__Host-PaCT.PasskeyCeremony", "__Host-PaCT.Push" })
            context.Response.Cookies.Delete(name, IdentityCookies.Options(TimeSpan.Zero));
        context.RequestServices.GetRequiredService<GoogleFlows>().Remove(context.Request.Cookies[GoogleFlows.Cookie]);
        context.Response.Cookies.Delete(GoogleFlows.Cookie, GoogleFlows.Options);
    }
}
