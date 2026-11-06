using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.WebUtilities;
using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public static class GoogleCalendarAuthorization
{
    public const string Scheme = "PaCT.GoogleCalendar";
    public const string ReturnPath = "/#calendario-google";

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
            options.Scope.Add("https://www.googleapis.com/auth/calendar.freebusy");
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
                    || account.SecurityStamp != stamp || string.IsNullOrWhiteSpace(refreshToken))
                {
                    context.Response.Redirect(ReturnPath + "?ligacao=falhou");
                    return;
                }
                try
                {
                    await services.GetRequiredService<GoogleCalendarAvailability>().ConnectAsync(refreshToken, ct);
                    context.Response.Redirect(ReturnPath);
                }
                catch (Exception error) when (!ct.IsCancellationRequested && (GoogleCalendarAvailability.IsUnavailable(error) || error is IdentityProblem))
                {
                    context.Response.Redirect(ReturnPath + "?ligacao=falhou");
                }
            };
            options.Events.OnRemoteFailure = context =>
            {
                context.HandleResponse();
                context.Response.Redirect(ReturnPath + "?ligacao=falhou");
                return Task.CompletedTask;
            };
        });
    }
}
