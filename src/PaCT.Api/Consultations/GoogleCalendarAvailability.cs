using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public sealed class GoogleCalendarSettings(IConfiguration config)
{
    public string? ClientId => config["GoogleCalendar:ClientId"];
    public string? ClientSecret => config["GoogleCalendar:ClientSecret"];
    public const string CallbackPath = "/connect-google-calendar";
    public string? Callback => Uri.TryCreate(config["Application:WebUrl"] ?? config["Application:PublicUrl"], UriKind.Absolute, out var url)
        && url.Scheme == "https" && url.UserInfo.Length == 0 ? url.GetLeftPart(UriPartial.Authority) + CallbackPath : null;
    public bool Configured => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret) && Callback is not null;
}

public sealed record GoogleCalendarSnapshot(AvailabilityRange[] Busy, DateTimeOffset? CheckedAt, bool Connected, bool Unavailable)
{
    public static GoogleCalendarSnapshot Empty { get; } = new([], null, false, false);
}

public sealed class GoogleCalendarAvailability
{
    public const string Client = "GoogleCalendar";
    public const string TokenEndpoint = "https://oauth2.googleapis.com/token";
    private const string FreeBusyEndpoint = "https://www.googleapis.com/calendar/v3/freeBusy";
    private readonly GoogleCalendarSettings settings;
    private readonly IHttpClientFactory clients;
    private readonly TimeProvider time;
    private readonly ILogger<GoogleCalendarAvailability> logger;
    private readonly IDataProtector protector;
    private readonly string path;
    private readonly SemaphoreSlim gate = new(1);
    private Connection? connection;
    private GoogleCalendarSnapshot snapshot = GoogleCalendarSnapshot.Empty;
    private string? accessToken;
    private DateTimeOffset accessExpiresAt, nextCheck, checkedThrough;
    private sealed record Connection(string RefreshToken, AvailabilityRange[] Busy, DateTimeOffset CheckedAt);

    public GoogleCalendarAvailability(GoogleCalendarSettings settings, IHttpClientFactory clients, TimeProvider time,
        InstallationPaths paths, IDataProtectionProvider protection, ILogger<GoogleCalendarAvailability> logger)
        : this(settings, clients, time, Path.Combine(paths.Root, "google-calendar.protected"), protection, logger)
    {
    }

    internal GoogleCalendarAvailability(GoogleCalendarSettings settings, IHttpClientFactory clients, TimeProvider time,
        string path, IDataProtectionProvider protection, ILogger<GoogleCalendarAvailability> logger)
    {
        this.settings = settings;
        this.clients = clients;
        this.time = time;
        this.logger = logger;
        protector = protection.CreateProtector("PaCT0.2.GoogleCalendar.availability.v1");
        this.path = path;
        if (!File.Exists(path)) return;
        try
        {
            connection = JsonSerializer.Deserialize<Connection>(protector.Unprotect(File.ReadAllBytes(path)))
                ?? throw new CryptographicException();
            snapshot = new(connection.Busy, connection.CheckedAt, true, true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or CryptographicException or JsonException)
        {
            snapshot = new([], null, true, true);
            logger.LogWarning("Não foi possível carregar a ligação Google Calendar ({ErrorType}).", error.GetType().Name);
        }
    }

    public GoogleCalendarSnapshot Current => Volatile.Read(ref snapshot);

    public async Task ConnectAsync(string refreshToken, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(refreshToken) || !settings.Configured)
            throw new IdentityProblem(409, "O Google não autorizou a consulta do calendário. Volta a ligar a conta.");
        await gate.WaitAsync(ct);
        try
        {
            var now = time.GetUtcNow();
            var through = AgendaRules.HorizonEndExclusive(now).AddDays(8);
            using var client = clients.CreateClient(Client);
            var token = await GetTokenAsync(client, refreshToken, ct);
            var busy = await GetBusyAsync(client, token.Value, now, through, ct);
            Save(new(refreshToken, busy, now));
            accessToken = token.Value;
            accessExpiresAt = token.ExpiresAt;
            checkedThrough = through;
            nextCheck = now.AddSeconds(45);
            Volatile.Write(ref snapshot, new(busy, now, true, false));
        }
        finally { gate.Release(); }
    }

    public async Task RefreshAsync(CancellationToken ct, bool force = false, DateTimeOffset? requiredThrough = null)
    {
        if (!Current.Connected || !settings.Configured) return;
        await gate.WaitAsync(ct);
        try
        {
            if (connection is null) return;
            var now = time.GetUtcNow();
            var through = AgendaRules.HorizonEndExclusive(now).AddDays(8);
            if (checkedThrough > through) through = checkedThrough;
            if (requiredThrough > through) through = requiredThrough.Value;
            if (now < nextCheck && (Current.Unavailable || !force && through <= checkedThrough)) return;
            try
            {
                using var client = clients.CreateClient(Client);
                if (accessToken is null || accessExpiresAt <= now.AddMinutes(1))
                    (accessToken, accessExpiresAt) = await GetTokenAsync(client, connection.RefreshToken, ct);
                var busy = await GetBusyAsync(client, accessToken, now, through, ct);
                checkedThrough = through;
                nextCheck = now.AddSeconds(45);
                Volatile.Write(ref snapshot, new(busy, now, true, false));
                if (!connection.Busy.SequenceEqual(busy)) Save(connection with { Busy = busy, CheckedAt = now });
            }
            catch (Exception error) when (!ct.IsCancellationRequested && IsUnavailable(error))
            {
                accessToken = null;
                nextCheck = now.AddSeconds(30);
                if (!Current.Unavailable) logger.LogWarning("Google Calendar temporariamente indisponível ({ErrorType}).", error.GetType().Name);
                Volatile.Write(ref snapshot, Current with { Unavailable = true });
            }
        }
        finally { gate.Release(); }
    }

    internal static bool IsUnavailable(Exception error) => error is HttpRequestException or IOException or UnauthorizedAccessException
        or OperationCanceledException or JsonException or CryptographicException;

    private void Save(Connection value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + "." + Guid.NewGuid().ToString("N");
        try
        {
            File.WriteAllBytes(temporary, protector.Protect(JsonSerializer.SerializeToUtf8Bytes(value)));
            File.Move(temporary, path, overwrite: true);
            connection = value;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private async Task<(string Value, DateTimeOffset ExpiresAt)> GetTokenAsync(HttpClient client, string refreshToken, CancellationToken ct)
    {
        using var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token", ["refresh_token"] = refreshToken,
            ["client_id"] = settings.ClientId!, ["client_secret"] = settings.ClientSecret!
        });
        using var response = await client.PostAsync(TokenEndpoint, form, ct);
        response.EnsureSuccessStatusCode();
        var token = await response.Content.ReadFromJsonAsync<Token>(cancellationToken: ct);
        if (token is not { Value.Length: > 0, Lifetime: > 0 }) throw new JsonException("Resposta de autorização incompleta.");
        return (token.Value, time.GetUtcNow().AddSeconds(token.Lifetime));
    }

    private static async Task<AvailabilityRange[]> GetBusyAsync(HttpClient client, string token, DateTimeOffset now, DateTimeOffset through, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, FreeBusyEndpoint)
        {
            Content = JsonContent.Create(new
            {
                timeMin = AgendaRules.Midnight(AgendaRules.LocalDate(now)),
                timeMax = through.ToUniversalTime(),
                items = new[] { new { id = "primary" } }
            })
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await client.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        var data = await response.Content.ReadFromJsonAsync<FreeBusy>(cancellationToken: ct);
        if (data?.Calendars is not { Count: 1 } calendars || calendars.Values.Single() is not { Errors: null or { Length: 0 }, Busy: { } blocks }
            || blocks.Any(block => block.End <= block.Start))
            throw new JsonException("Não foi possível verificar os períodos ocupados.");
        var busy = new List<AvailabilityRange>();
        foreach (var block in blocks.Where(block => block.End > now).OrderBy(block => block.Start))
        {
            if (busy.Count == 0 || block.Start > busy[^1].EndsAt)
                busy.Add(new(block.Start.ToUniversalTime(), block.End.ToUniversalTime()));
            else if (block.End > busy[^1].EndsAt) busy[^1] = busy[^1] with { EndsAt = block.End.ToUniversalTime() };
        }
        return busy.ToArray();
    }

    private sealed record Token(
        [property: System.Text.Json.Serialization.JsonPropertyName("access_token")] string Value,
        [property: System.Text.Json.Serialization.JsonPropertyName("expires_in")] int Lifetime);
    private sealed record FreeBusy(Dictionary<string, Calendar>? Calendars);
    private sealed record Calendar(BusyInterval[]? Busy, JsonElement[]? Errors);
    private sealed record BusyInterval(DateTimeOffset Start, DateTimeOffset End);
}
