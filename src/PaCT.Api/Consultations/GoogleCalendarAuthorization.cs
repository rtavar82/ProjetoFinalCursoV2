using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.WebUtilities;
using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public static class GoogleCalendarAuthorization
{
    public const string Scheme = "PaCT.GoogleCalendar";
    public const string ReturnPath = "/#calendario-google";
    internal const string EventReadScope = "https://www.googleapis.com/auth/calendar.events.readonly";

    public static void AddGoogleCalendar(this WebApplicationBuilder builder)
    {
        builder.Services.AddSingleton<GoogleCalendarSettings>();
        builder.Services.AddSingleton<GoogleCalendarAvailability>();
        builder.Services.AddHttpClient(GoogleCalendarAvailability.Client, client => client.Timeout = TimeSpan.FromSeconds(3));
        var settings = new GoogleCalendarSettings(builder.Configuration);
        if (!settings.Configured) return;

        builder.Services.AddAuthentication().AddOAuth(Scheme, options =>
        {
            options.ClientId = settings.ClientId!;
            options.ClientSecret = settings.ClientSecret!;
            options.SignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
            options.AuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
            options.TokenEndpoint = GoogleCalendarAvailability.TokenEndpoint;
            options.CallbackPath = GoogleCalendarSettings.CallbackPath;
            options.UsePkce = true;
            options.SaveTokens = true;
            options.BackchannelTimeout = TimeSpan.FromSeconds(8);
            options.RemoteAuthenticationTimeout = TimeSpan.FromMinutes(5);
            options.Scope.Add("https://www.googleapis.com/auth/calendar.events.freebusy");
            options.Scope.Add(EventReadScope);
            options.Scope.Add("https://www.googleapis.com/auth/calendar.calendarlist.readonly");
            options.Scope.Add("https://www.googleapis.com/auth/calendar.app.created");
            options.CorrelationCookie.Name = "__Host-PaCT.GoogleCalendarCorrelation.";
            options.CorrelationCookie.Path = "/";
            options.Events.OnRedirectToAuthorizationEndpoint = async context =>
            {
                var query = QueryHelpers.ParseQuery(new Uri(context.RedirectUri).Query);
                if (query["redirect_uri"] != settings.Callback)
                    throw new IdentityProblem(409, "Abre a PaCT pelo endereço seguro configurado para a ligação ao Google.");
                var url = QueryHelpers.AddQueryString(context.RedirectUri, new Dictionary<string, string?>
                {
                    ["access_type"] = "offline", ["prompt"] = "consent select_account"
                });
                await context.Response.WriteAsJsonAsync(new { url }, context.HttpContext.RequestAborted);
            };
            options.Events.OnTicketReceived = async context =>
            {
                // The provider ticket is consumed here and never becomes a PaCT sign-in session.
                context.HandleResponse();
                var ct = context.HttpContext.RequestAborted;
                var services = context.HttpContext.RequestServices;
                var properties = context.Properties!;
                properties.Items.TryGetValue("account", out var accountId);
                properties.Items.TryGetValue("stamp", out var stamp);
                var account = accountId is not null ? await services.GetRequiredService<IIdentityStore>().FindAsync(accountId, ct) : null;
                var refreshToken = properties.GetTokenValue("refresh_token");
                if (account is not { PersonActive: true, ClosedAt: null, LinkStatus: "Verified" } || !Roles.IsManager(account.Role)
                    || account.SecurityStamp != stamp)
                {
                    RedirectFailure(context.HttpContext, "sessao");
                    return;
                }
                if (string.IsNullOrWhiteSpace(refreshToken))
                {
                    RedirectFailure(context.HttpContext, "autorizacao");
                    return;
                }
                try
                {
                    await services.GetRequiredService<GoogleCalendarAvailability>().ConnectAsync(refreshToken, ct);
                    context.Response.Redirect(ReturnPath);
                }
                catch (GoogleCalendarLinkFailure error)
                {
                    RedirectFailure(context.HttpContext, error.Step, error.InnerException);
                }
                catch (IdentityProblem)
                {
                    RedirectFailure(context.HttpContext, "autorizacao");
                }
            };
            options.Events.OnRemoteFailure = context =>
            {
                context.HandleResponse();
                var reason = context.Failure?.Data["error"] as string;
                var step = reason switch
                {
                    "access_denied" or "admin_policy_enforced" => "permissao",
                    "invalid_client" or "deleted_client" or "unauthorized_client" or "redirect_uri_mismatch" => "configuracao",
                    "invalid_grant" => "sessao",
                    _ when context.Failure?.Message is "Correlation failed." or "The oauth state was missing or invalid." => "sessao",
                    _ => "regresso"
                };
                RedirectFailure(context.HttpContext, step, context.Failure);
                return Task.CompletedTask;
            };
        });
    }

    private static void RedirectFailure(HttpContext context, string step, Exception? error = null)
    {
        context.RequestServices.GetRequiredService<ILogger<GoogleCalendarAvailability>>()
            .LogWarning("Ligação ao Google Calendar não concluída. Etapa: {Step}; erro: {ErrorType}; HTTP: {StatusCode}.",
                step, error?.GetType().Name, (int?)(error as HttpRequestException)?.StatusCode);
        context.Response.Redirect(ReturnPath + "?ligacao=" + step);
    }
}
