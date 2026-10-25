using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using PaCT.Api.Identity;
using PaCT.Api.Clients;
using System.Security.Claims;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/identity")]
[RequestSizeLimit(32768)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class IdentityController(IIdentityStore store, IInstallationSecrets installation, IdentityService service,
    IdentityCookies cookies) : ControllerBase
{
    [HttpGet("installation")]
    public async Task<IActionResult> Installation(CancellationToken ct) => Ok(new
    {
        prepared = installation.IsPrepared,
        managerExists = installation.IsPrepared && await store.HasTechnicalManagerAsync(ct)
    });

    [HttpGet("csrf")]
    public IActionResult Csrf([FromServices] IAntiforgery antiforgery) => Ok(new { token = antiforgery.GetAndStoreTokens(HttpContext).RequestToken });

    [HttpPost("technical-manager"), EnableRateLimiting("email")]
    public async Task<IActionResult> Register(ManagerRegistration input, CancellationToken ct)
    {
        if (IdentityValidation.MissingNameMessage(input.FirstName, input.LastName) is { } missingName)
            return Problem(statusCode: 400, title: missingName);
        var account = await service.RegisterAsync(input, ct);
        cookies.SetPending(HttpContext, account);
        return Ok(new { stage = "ConfirmEmail", message = "Conta criada. A confirmação de email ficou em fila de envio. O acesso à gestão ainda não está ativo." });
    }

    [HttpPost("sign-in"), EnableRateLimiting("identity")]
    public async Task<IActionResult> SignIn(PasswordSignIn input, CancellationToken ct)
    {
        var result = await service.SignInAsync(input, HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown", ct);
        if (result.Account is not { } account) return Problem(statusCode: result.Status, title: result.Message);
        var trustedUntil = cookies.TrustedUntil(HttpContext, account);
        if (account.PasskeyEnabledAt is not null && trustedUntil is null)
        {
            cookies.SetPending(HttpContext, account);
            return Ok(new { stage = "VerifyPasskey" });
        }
        if (account.Role == Roles.Client && account.EmailConfirmedAt is not null && account.TwoFactorEnabledAt is null && account.PasskeyEnabledAt is null)
        {
            await service.CompleteTrustedSignInAsync(account, ct);
            await cookies.SignInAsync(HttpContext, account, false);
            return Ok(new { stage = "SignedIn" });
        }
        if (account.EmailConfirmedAt is not null && trustedUntil is not null)
        {
            await service.CompleteTrustedSignInAsync(account, ct);
            await cookies.SignInAsync(HttpContext, account, false, trustedUntil);
            return Ok(new { stage = "SignedIn" });
        }
        cookies.SetPending(HttpContext, account);
        return Ok(new { stage = Stage(account) });
    }

    [HttpGet("progress")]
    public async Task<IActionResult> Progress(CancellationToken ct)
    {
        var account = await service.PendingAccountAsync(cookies.ReadPending(HttpContext), ct);
        if (account is null) return Ok(new { stage = "SignIn" });
        return Ok(new { stage = Stage(account), displayName = account.DisplayName, emailState = await store.LatestEmailStateAsync(account.Id, ct) });
    }

    [HttpPost("confirm-email"), EnableRateLimiting("account")]
    public async Task<IActionResult> ConfirmEmail(EmailConfirmation input, CancellationToken ct)
    {
        if (User.Identity?.IsAuthenticated == true) return Conflict(new ProblemDetails { Status = 409, Title = "Termina a sessão atual ou abre o link numa janela privada antes de confirmar outra conta." });
        var account = await service.ConfirmEmailAsync(input.Token, ct);
        if (account.Role == Roles.Client)
        {
            cookies.SetPending(HttpContext, account);
            return Ok(new { stage = "SetPassword", message = "Email confirmado. Define agora a tua palavra-passe para aceder à conta." });
        }
        return Ok(new { message = "Email confirmado. Continua a configuração no navegador onde criaste a conta, ou entra com a tua palavra-passe." });
    }

    [HttpPost("client-registration"), EnableRateLimiting("email")]
    public async Task<IActionResult> RegisterClient(ClientProfile input, [FromServices] ClientService clients, CancellationToken ct)
    {
        if (User.Identity?.IsAuthenticated == true) return Conflict(new ProblemDetails { Status = 409, Title = "Termina a sessão atual para iniciar um registo pessoal." });
        if (ClientValidation.MissingRegistrationMessage(input) is { } missingField) return Problem(statusCode: 400, title: missingField);
        if (!await store.HasTechnicalManagerAsync(ct)) return StatusCode(503, new ProblemDetails { Status = 503, Title = "A instalação ainda não está disponível para registos de clientes." });
        return Ok(await clients.RegisterAsync(input, ct));
    }

    [HttpPost("first-password"), EnableRateLimiting("account")]
    public async Task<IActionResult> FirstPassword(FirstPassword input, CancellationToken ct)
    {
        var account = await service.PendingAccountAsync(cookies.ReadPending(HttpContext), ct);
        if (account is null) return PendingSignInRequired();
        var updated = await service.SetFirstPasswordAsync(account, input.Password, input.ConfirmPassword, ct);
        await cookies.SignInAsync(HttpContext, updated, false);
        return Ok(new { stage = "SignedIn", message = "Palavra-passe criada. Podes completar a ficha sem deixar de utilizar a conta." });
    }

    [HttpPost("client-registration-review"), EnableRateLimiting("account")]
    public async Task<IActionResult> RegistrationReview(RegistrationReviewStatus input, [FromServices] ClientService clients, CancellationToken ct) =>
        Ok(await clients.RegistrationReviewAsync(input.Token, ct));

    [Authorize(Roles = Roles.Client), HttpPost("enable-authenticator"), EnableRateLimiting("account")]
    public async Task<IActionResult> EnableAuthenticator(CancellationToken ct)
    {
        var account = await store.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, ct);
        if (account is null) return Unauthorized();
        if (account.TwoFactorEnabledAt is not null) return Conflict(new ProblemDetails { Status = 409, Title = "O autenticador já está ativo." });
        cookies.SetPending(HttpContext, account);
        return Ok(new { stage = "ConfigureAuthenticator" });
    }

    [HttpPost("resend-email"), EnableRateLimiting("email")]
    public async Task<IActionResult> ResendEmail(CancellationToken ct)
    {
        var account = await service.PendingAccountAsync(cookies.ReadPending(HttpContext), ct);
        if (account is null) return PendingSignInRequired();
        await service.ResendEmailAsync(account, ct);
        return Ok(new { message = "Foi pedido um novo envio. Os links anteriores foram substituídos. Não é garantida a entrega na caixa de entrada." });
    }

    [HttpPost("authenticator"), EnableRateLimiting("account")]
    public async Task<IActionResult> Authenticator(CancellationToken ct)
    {
        var account = await service.PendingAccountAsync(cookies.ReadPending(HttpContext), ct);
        if (account is null) return PendingSignInRequired();
        return Ok(await service.AuthenticatorAsync(account, ct));
    }

    [HttpPost("verify-factor"), EnableRateLimiting("identity")]
    public async Task<IActionResult> VerifyFactor(FactorVerification input, CancellationToken ct)
    {
        var account = await service.PendingAccountAsync(cookies.ReadPending(HttpContext), ct);
        if (account is null) return PendingSignInRequired();
        var verified = await service.VerifyFactorAsync(account, input.Code, ct);
        var fresh = await store.FindAsync(account.Id, ct) ?? throw new IdentityProblem(401, "Inicia sessão novamente.");
        var method = cookies.ReadPending(HttpContext)?.Method ?? "Password";
        if (fresh.PasswordSignInRequired && method == "Password")
        {
            await service.CompleteTrustedSignInAsync(fresh, ct);
            fresh = await store.FindAsync(account.Id, ct) ?? throw new IdentityProblem(401, "Inicia sessão novamente.");
        }
        await cookies.SignInAsync(HttpContext, fresh, input.RememberDevice, method: method);
        return Ok(new { stage = "SignedIn", recoveryCodes = verified.RecoveryCodes });
    }

    [Authorize, HttpGet("me")]
    public async Task<IActionResult> Me(CancellationToken ct, [FromServices] IPasskeyStore passkeys)
    {
        var account = await store.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, ct);
        return account is null ? Unauthorized() : Ok(new { id = account.Id, personId = account.PersonId,
            displayName = account.DisplayName, role = account.Role, twoFactorEnabled = account.TwoFactorEnabledAt is not null, passkeyEnabled = account.PasskeyEnabledAt is not null,
            passkeyVerified = account.PasskeyEnabledAt is not null && (await passkeys.ListAsync(account.Id, ct)).Any(k => k.LastUsedAt is not null) });
    }

    [Authorize(Roles = Roles.Client), HttpPost("close-account"), EnableRateLimiting("account")]
    public async Task<IActionResult> CloseAccount(AccountClosure input, CancellationToken ct)
    {
        var account = await store.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, ct);
        if (account is null) return Unauthorized();
        await service.CloseClientAccountAsync(account, input, ct);
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        foreach (var name in new[] { IdentityCookies.Pending, IdentityCookies.Trusted, "__Host-PaCT.PasskeyCeremony", "__Host-PaCT.Push" })
            Response.Cookies.Delete(name, IdentityCookies.Options(TimeSpan.Zero));
        return Ok(new { stage = "SignIn", accountState = "Closed", message = "A tua conta foi encerrada. O saldo, as dívidas e as marcações não foram alterados." });
    }

    [Authorize, HttpPost("sign-out")]
    public async Task<IActionResult> SignOutAccount([FromServices] PaCT.Api.Consultations.BrowserPushStore push,
        [FromServices] PaCT.Api.Consultations.BalancePushKeys pushKeys, CancellationToken ct)
    {
        var account = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var subscriptionId = pushKeys.ReadBrowser(account, Request.Cookies["__Host-PaCT.Push"]);
        if (subscriptionId is not null) await push.Remove(subscriptionId, account, ct);
        Response.Cookies.Delete("__Host-PaCT.Push", IdentityCookies.Options(TimeSpan.Zero));
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        Response.Cookies.Delete(IdentityCookies.Pending, IdentityCookies.Options(TimeSpan.Zero));
        return Ok(new { message = "Sessão terminada." });
    }

    [HttpPost("forget-browser")]
    public IActionResult ForgetBrowser([FromServices] GoogleFlows flows)
    {
        Response.Cookies.Delete(IdentityCookies.Trusted, IdentityCookies.Options(TimeSpan.Zero));
        flows.Remove(Request.Cookies[GoogleFlows.Cookie]);
        Response.Cookies.Delete(GoogleFlows.Cookie, GoogleFlows.Options);
        return Ok(new { message = "Este navegador deixou de estar reconhecido." });
    }

    private IActionResult PendingSignInRequired() => Unauthorized(new ProblemDetails
    {
        Status = StatusCodes.Status401Unauthorized,
        Title = "Esta verificação expirou. Inicia sessão novamente para continuar."
    });

    private static string Stage(IdentityAccount account) => account.EmailConfirmedAt is null ? "ConfirmEmail"
        : account.PasswordHash is null ? "SetPassword" : account.PasskeyEnabledAt is not null ? "VerifyPasskey" : account.TwoFactorEnabledAt is null ? "ConfigureAuthenticator" : "VerifyFactor";
}
