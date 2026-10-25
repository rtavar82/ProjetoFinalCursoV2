using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.AuthenticatedEncryption;
using Microsoft.AspNetCore.DataProtection.AuthenticatedEncryption.ConfigurationModel;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using System.Security.Claims;
using System.Threading.RateLimiting;

namespace PaCT.Api.Identity;

public static class IdentityRegistration
{
    public static void AddAccountSecurity(this WebApplicationBuilder builder)
    {
        builder.Services.AddSingleton<InstallationPaths>();
        var keys = builder.Services.AddDataProtection()
            .UseCryptographicAlgorithms(new AuthenticatedEncryptorConfiguration { EncryptionAlgorithm = EncryptionAlgorithm.AES_256_GCM });
        builder.Services.AddOptions<DataProtectionOptions>().Configure<InstallationPaths>((options, paths) => options.ApplicationDiscriminator = "PaCT:" + paths.Id);
        builder.Services.AddOptions<KeyManagementOptions>().Configure<InstallationPaths, ILoggerFactory>((options, paths, loggerFactory) =>
            options.XmlRepository = new FileSystemXmlRepository(new DirectoryInfo(Path.Combine(paths.Root, "keys")), loggerFactory));
        if (OperatingSystem.IsWindows()) keys.ProtectKeysWithDpapi(protectToLocalMachine: false);
        else throw new InvalidOperationException("This increment requires Windows-protected key storage. Configure a protected key provider before deployment on another platform.");
        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddSingleton<InstallationSecrets>();
        builder.Services.AddSingleton<IInstallationSecrets>(services => services.GetRequiredService<InstallationSecrets>());
        builder.Services.AddSingleton<IdentitySecurity>();
        builder.Services.AddSingleton<MySqlIdentityStore>();
        builder.Services.AddSingleton<IIdentityStore>(services => services.GetRequiredService<MySqlIdentityStore>());
        builder.Services.AddSingleton<ITherapistInvitationStore>(services => services.GetRequiredService<MySqlIdentityStore>());
        builder.Services.AddSingleton<ISecurityEmailTransport, SmtpSecurityEmailTransport>();
        builder.Services.AddSingleton<IdentityService>();
        builder.Services.AddSingleton<TherapistInvitationService>();
        builder.Services.AddSingleton<PaCT.Api.Clients.IClientStore, PaCT.Api.Clients.MySqlClientStore>();
        builder.Services.AddSingleton<PaCT.Api.Clients.ClientService>();
        builder.Services.AddSingleton<IdentityCookies>();
        builder.Services.AddSingleton<IPasskeyStore, MySqlPasskeyStore>();
        builder.Services.AddSingleton<PasskeyService>();
        builder.Services.AddSingleton<IClientAccessStore, MySqlClientAccessStore>();
        builder.Services.AddSingleton<ClientAccessService>();
        builder.AddGoogleAccountLogin();
        builder.Services.AddHostedService<SecurityEmailWorker>();
        builder.Services.AddAntiforgery(options =>
        {
            options.HeaderName = "X-PaCT-CSRF";
            options.Cookie.Name = "__Host-PaCT.Csrf";
            options.Cookie.HttpOnly = true;
            options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            options.Cookie.SameSite = SameSiteMode.Strict;
        });
        builder.Services.AddScoped<ApiAntiforgeryFilter>();
        builder.Services.AddControllers(options => options.Filters.AddService<ApiAntiforgeryFilter>());
        builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(options =>
        {
            options.Cookie.Name = IdentityCookies.Session;
            options.Cookie.HttpOnly = true;
            options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            options.Cookie.SameSite = SameSiteMode.Strict;
            options.ExpireTimeSpan = TimeSpan.FromHours(8);
            options.SlidingExpiration = true;
            options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
            options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
            options.Events.OnValidatePrincipal = async context =>
            {
                var principal = context.Principal;
                var id = principal?.FindFirstValue(ClaimTypes.NameIdentifier);
                var account = id is null ? null : await context.HttpContext.RequestServices.GetRequiredService<IIdentityStore>().FindAsync(id, context.HttpContext.RequestAborted);
                var currentTime = context.HttpContext.RequestServices.GetRequiredService<TimeProvider>().GetUtcNow().ToUnixTimeSeconds();
                if (account is null || account.ClosedAt is not null || !account.PersonActive || account.LinkStatus != "Verified"
                    || account.EmailConfirmedAt is null || account.PasswordHash is null
                    || (account.PasskeyEnabledAt is not null ? principal?.FindFirstValue("amr") != "passkey"
                        : (account.Role != Roles.Client || account.TwoFactorEnabledAt is not null)
                            && (account.TwoFactorEnabledAt is null || principal?.FindFirstValue("amr") != "mfa"))
                    || !long.TryParse(principal?.FindFirstValue("mfa_valid_until"), out var mfaUntil) || mfaUntil <= currentTime
                    || account.SecurityStamp != principal?.FindFirstValue("security_stamp") || account.Role != principal.FindFirstValue(ClaimTypes.Role))
                    context.RejectPrincipal();
            };
        });
        builder.Services.AddAuthorization();
        builder.Services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = 429;
            options.OnRejected = async (context, ct) =>
            {
                if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var wait))
                    context.HttpContext.Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling(wait.TotalSeconds)).ToString(System.Globalization.CultureInfo.InvariantCulture);
                await context.HttpContext.Response.WriteAsJsonAsync(new Microsoft.AspNetCore.Mvc.ProblemDetails
                {
                    Status = 429, Title = "O limite temporário de pedidos foi atingido. Aguarda antes de voltar a tentar."
                }, ct);
            };
            // Explicit operation policies only: normal navigation, polling and agenda previews are not counted.
            options.AddPolicy("identity", context => RateLimitPartition.GetFixedWindowLimiter("sign-in:" + (context.Connection.RemoteIpAddress?.ToString() ?? "unknown"),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 100, Window = TimeSpan.FromMinutes(15), QueueLimit = 0 }));
            options.AddPolicy("account", context => RateLimitPartition.GetFixedWindowLimiter(OperationKey(context, "account"),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 100, Window = TimeSpan.FromMinutes(15), QueueLimit = 0 }));
            options.AddPolicy("email", context => RateLimitPartition.GetFixedWindowLimiter(OperationKey(context, "email"),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 3, Window = TimeSpan.FromMinutes(15), QueueLimit = 0 }));
            options.AddPolicy("guest-request", context => RateLimitPartition.GetFixedWindowLimiter(OperationKey(context, "guest-request"),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 100, Window = TimeSpan.FromMinutes(15), QueueLimit = 0 }));
            options.AddPolicy("upload", context => RateLimitPartition.GetFixedWindowLimiter(OperationKey(context, "upload"),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
            options.AddPolicy("write", context => RateLimitPartition.GetFixedWindowLimiter(OperationKey(context, "write"),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 240, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
        });
    }

    private static string OperationKey(HttpContext context, string category)
    {
        var account = context.User.Identity?.IsAuthenticated == true ? context.User.FindFirstValue(ClaimTypes.NameIdentifier) : null;
        var owner = account is null ? "ip:" + (context.Connection.RemoteIpAddress?.ToString() ?? "unknown") : "account:" + account;
        // Route patterns group uploads/requests across record IDs, preventing a new budget per file or event.
        var operation = (context.GetEndpoint() as Microsoft.AspNetCore.Routing.RouteEndpoint)?.RoutePattern.RawText ?? context.Request.Path.Value;
        return $"{category}:{context.Request.Method}:{operation}:{owner}";
    }
}
