using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using System.Security.Claims;

namespace PaCT.Api.Identity;

public sealed class IdentityCookies(IdentitySecurity security, TimeProvider time)
{
    public const string Pending = "__Host-PaCT.Pending";
    public const string Trusted = "__Host-PaCT.TrustedBrowser";
    public const string Session = "__Host-PaCT.Session";

    public void SetPending(HttpContext context, IdentityAccount account, string method = "Password") => context.Response.Cookies.Append(Pending,
        security.ProtectAction("pending", new(account.Id, account.SecurityStamp, Method: method), TimeSpan.FromMinutes(15)), Options(TimeSpan.FromMinutes(15)));

    public ActionToken? ReadPending(HttpContext context)
    {
        if (security.TryReadAction("pending", context.Request.Cookies[Pending], out var token, out var expiresAt)
            && expiresAt > time.GetUtcNow()) return token;
        if (context.Request.Cookies.ContainsKey(Pending)) context.Response.Cookies.Delete(Pending, Options(TimeSpan.Zero));
        return null;
    }

    public DateTimeOffset? TrustedUntil(HttpContext context, IdentityAccount account) => TrustedUntil(context.Request.Cookies[Trusted], account);

    public DateTimeOffset? TrustedUntil(string? protectedProof, IdentityAccount account)
    {
        return security.TryReadAction(account.PasskeyEnabledAt is null ? "trusted-browser" : "trusted-passkey-browser", protectedProof, out var token, out var expiresAt)
            && token.AccountId == account.Id && token.Stamp == account.SecurityStamp && (account.TwoFactorEnabledAt is not null || account.PasskeyEnabledAt is not null)
            && expiresAt > time.GetUtcNow() ? expiresAt : null;
    }

    public async Task SignInAsync(HttpContext context, IdentityAccount account, bool rememberDevice, DateTimeOffset? trustedUntil = null, string method = "Password")
    {
        if (account.PasswordSignInRequired && method == "Google") throw new IdentityProblem(403, "Entra com o teu email e a nova palavra-passe.");
        if (account.EmailConfirmedAt is null || account.PasswordHash is null || (account.Role != Roles.Client && account.TwoFactorEnabledAt is null && account.PasskeyEnabledAt is null) || account.ClosedAt is not null)
            throw new IdentityProblem(403, "Conclui a confirmação do email e a configuração do autenticador.");
        var claims = new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, account.Id), new Claim(ClaimTypes.Name, account.DisplayName),
            new Claim(ClaimTypes.Role, account.Role), new Claim("security_stamp", account.SecurityStamp), new Claim("amr", account.PasskeyEnabledAt is not null ? "passkey" : account.TwoFactorEnabledAt is null ? method == "Google" ? "google" : "pwd" : "mfa"),
            new Claim("primary_auth", method),
            new Claim("mfa_valid_until", (trustedUntil ?? time.GetUtcNow().AddDays(30)).ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture))
        ], CookieAuthenticationDefaults.AuthenticationScheme);
        await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(claims),
            new AuthenticationProperties { IsPersistent = false, AllowRefresh = true });
        context.Response.Cookies.Delete(Pending, Options(TimeSpan.Zero));
        if (rememberDevice && (account.TwoFactorEnabledAt is not null || account.PasskeyEnabledAt is not null)) context.Response.Cookies.Append(Trusted,
            security.ProtectAction(account.PasskeyEnabledAt is null ? "trusted-browser" : "trusted-passkey-browser", new(account.Id, account.SecurityStamp), TimeSpan.FromDays(30)), Options(TimeSpan.FromDays(30)));
    }

    public static CookieOptions Options(TimeSpan lifetime) => new()
    {
        HttpOnly = true, Secure = true, SameSite = SameSiteMode.Strict, Path = "/", IsEssential = true,
        MaxAge = lifetime
    };
}
