using System.Collections.Concurrent;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.OAuth.Claims;
using Microsoft.AspNetCore.WebUtilities;

namespace PaCT.Api.Identity;

public sealed class GoogleLoginSettings(IConfiguration configuration)
{
    public string? ClientId => configuration["Authentication:Google:ClientId"];
    public string? ClientSecret => configuration["Authentication:Google:ClientSecret"];
    public bool Enabled => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret)
        && Uri.TryCreate(configuration["Application:WebUrl"] ?? configuration["Application:PublicUrl"], UriKind.Absolute, out var uri)
        && uri.Scheme == "https" && string.IsNullOrEmpty(uri.UserInfo);
    public string Callback => new Uri(configuration["Application:WebUrl"] ?? configuration["Application:PublicUrl"]!).GetLeftPart(UriPartial.Authority) + "/signin-google";
    public void Check() { if (!Enabled) throw new IdentityProblem(503, "A entrada com Google ainda não está disponível."); }
}

public sealed record GoogleFlow(string Id, string Mode, string? AccountId, string? Stamp, DateTimeOffset ExpiresAt, string? TrustedBrowser);
public sealed class GoogleFlows(TimeProvider time)
{
    public const string Cookie = "__Host-PaCT.GoogleFlow";
    private readonly ConcurrentDictionary<string, (GoogleFlow Flow, bool Started)> flows = new();
    public string Create(string mode, IdentityAccount? account, string? trustedBrowser = null)
    {
        foreach (var item in flows.Where(p => p.Value.Flow.ExpiresAt <= time.GetUtcNow())) flows.TryRemove(item.Key, out _);
        if (flows.Count >= 1000) throw new IdentityProblem(429, "Aguarda antes de voltares a tentar.");
        var id = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        // Capture only the protected cookie received by the CSRF-checked same-origin
        // start request. Strict cookies may be absent throughout the OAuth redirect chain.
        // Keep it server-side and revalidate account, stamp, purpose and expiry on return.
        flows[id] = (new(id, mode, account?.Id, account?.SecurityStamp, time.GetUtcNow().AddMinutes(5), mode == "SignIn" ? trustedBrowser : null), false);
        return id;
    }
    public GoogleFlow? Start(string? id)
    {
        if (id is null || !flows.TryGetValue(id, out var item) || item.Started || item.Flow.ExpiresAt <= time.GetUtcNow()) return null;
        return flows.TryUpdate(id, (item.Flow, true), item) ? item.Flow : null;
    }
    public GoogleFlow? Consume(string? id) => id is not null && flows.TryRemove(id, out var item) && item.Started && item.Flow.ExpiresAt > time.GetUtcNow() ? item.Flow : null;
    public void Remove(string? id) { if (id is not null) flows.TryRemove(id, out _); }
    public static CookieOptions Options => new() { HttpOnly = true, Secure = true, SameSite = SameSiteMode.Lax, Path = "/", MaxAge = TimeSpan.FromMinutes(5), IsEssential = true };
}

public static class GoogleAuthentication
{
    public const string ExternalScheme = "PaCT.GoogleExternal";
    public static void AddGoogleAccountLogin(this WebApplicationBuilder builder)
    {
        builder.Services.AddSingleton<GoogleLoginSettings>();
        builder.Services.AddSingleton<GoogleFlows>();
        builder.Services.AddSingleton<GoogleAccountService>();
        builder.Services.AddSingleton<PasswordChangeService>();
        var settings = new GoogleLoginSettings(builder.Configuration);
        var auth = builder.Services.AddAuthentication();
        auth.AddCookie(ExternalScheme, options =>
        {
            options.Cookie.Name = "__Host-PaCT.GoogleExternal";
            options.Cookie.HttpOnly = true; options.Cookie.SecurePolicy = CookieSecurePolicy.Always; options.Cookie.SameSite = SameSiteMode.Lax;
            options.ExpireTimeSpan = TimeSpan.FromMinutes(5); options.SlidingExpiration = false;
        });
        if (!settings.Enabled) return;
        auth.AddGoogle(options =>
        {
            options.ClientId = settings.ClientId!; options.ClientSecret = settings.ClientSecret!;
            options.SignInScheme = ExternalScheme; options.SaveTokens = false; options.UsePkce = true;
            options.RemoteAuthenticationTimeout = TimeSpan.FromMinutes(5);
            options.UserInformationEndpoint = "https://openidconnect.googleapis.com/v1/userinfo";
            options.Scope.Clear(); options.Scope.Add("openid"); options.Scope.Add("email");
            options.ClaimActions.Clear();
            options.ClaimActions.MapJsonKey(ClaimTypes.NameIdentifier, "sub");
            options.ClaimActions.MapJsonKey(ClaimTypes.Email, "email");
            options.ClaimActions.MapJsonKey("google_email_verified", "email_verified");
            options.CorrelationCookie.Name = "__Host-PaCT.GoogleCorrelation."; options.CorrelationCookie.Path = "/";
            options.Events.OnCreatingTicket = context =>
            {
                if (!string.Equals(context.Principal?.FindFirstValue("google_email_verified"), "true", StringComparison.OrdinalIgnoreCase)
                    || string.IsNullOrEmpty(context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier)))
                    throw new AuthenticationFailureException("Google identity was not verified.");
                return Task.CompletedTask;
            };
            options.Events.OnRedirectToAuthorizationEndpoint = context =>
            {
                var query = QueryHelpers.ParseQuery(new Uri(context.RedirectUri).Query);
                if (query["redirect_uri"] != settings.Callback) throw new IdentityProblem(503, "Abre a PaCT pelo endereço seguro configurado para esta instalação.");
                context.Response.Redirect(QueryHelpers.AddQueryString(context.RedirectUri, "prompt", "select_account"));
                return Task.CompletedTask;
            };
            options.Events.OnRemoteFailure = async context =>
            {
                context.HttpContext.RequestServices.GetRequiredService<GoogleFlows>().Remove(context.Request.Cookies[GoogleFlows.Cookie]);
                context.Response.Cookies.Delete(GoogleFlows.Cookie, GoogleFlows.Options);
                await context.HttpContext.SignOutAsync(ExternalScheme);
                context.HandleResponse(); context.Response.Redirect("/#google-result=Failed");
            };
        });
    }
}
