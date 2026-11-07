using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
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

public sealed record GoogleCalendarSnapshot(AvailabilityRange[] Busy, DateTimeOffset? CheckedAt, bool Connected, bool Unavailable,
    bool FamilyIncluded = false, bool NeedsReconnect = false, DateTimeOffset? PublishedAt = null, bool PublicationUnavailable = false)
{
    public static GoogleCalendarSnapshot Empty { get; } = new([], null, false, false);
}

internal sealed class GoogleCalendarLinkFailure(string step, Exception cause) : Exception("Falha na ligação ao Google Calendar.", cause)
{
    public string Step { get; } = step;
}

internal sealed class GoogleCalendarRequestRejected(string step)
    : HttpRequestException("O Google Calendar rejeitou o pedido de consulta.", null, HttpStatusCode.BadRequest)
{
    public string Step { get; } = step;
}

public sealed partial class GoogleCalendarAvailability
{
    public const string Client = "GoogleCalendar";
    public const string TokenEndpoint = "https://oauth2.googleapis.com/token";
    private const string FreeBusyEndpoint = "https://www.googleapis.com/calendar/v3/freeBusy";
    private const int FreeBusyWindowDays = 30;
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
    private sealed record Connection(string RefreshToken, AvailabilityRange[] Busy, DateTimeOffset CheckedAt,
        string? PrimaryId = null, string? FamilyId = null, string? PublicationMarker = null, string? PublicationCalendarId = null);

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
            snapshot = new(connection.Busy, connection.CheckedAt, true, true,
                FamilyIncluded: connection.FamilyId is not null, NeedsReconnect: connection.PrimaryId is null);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or CryptographicException or JsonException)
        {
            snapshot = new([], null, true, true, NeedsReconnect: true);
            logger.LogWarning("Não foi possível carregar a ligação Google Calendar ({ErrorType}).", error.GetType().Name);
        }
    }

    public GoogleCalendarSnapshot Current => Volatile.Read(ref snapshot);

    public async Task ConnectAsync(string refreshToken, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(refreshToken) || !settings.Configured)
            throw new IdentityProblem(409, "O Google não autorizou a consulta do calendário. Volta a ligar a conta.");
        await gate.WaitAsync(ct);
        var step = "renovacao";
        try
        {
            var now = time.GetUtcNow();
            var through = AgendaRules.HorizonEndExclusive(now).AddDays(8);
            using var client = clients.CreateClient(Client);
            var token = await GetTokenAsync(client, refreshToken, ct);
            step = "calendario";
            var calendars = await ListCalendarsAsync(client, token.Value, ct);
            var primary = calendars.SingleOrDefault(calendar => calendar.Primary);
            if (string.IsNullOrWhiteSpace(primary?.Id)) throw new JsonException("Calendário principal em falta.");
            var family = calendars.Where(calendar => !calendar.Primary && calendar.Id is { Length: > 0 }
                && IsFamilyCalendar(calendar.SummaryOverride ?? calendar.Summary)).Take(2).ToArray();
            var familyId = family.Length == 1 ? family[0].Id : null;
            var busy = await GetBusyAsync(client, token.Value, now, through, familyId, ct);
            step = "guardar";
            var previous = connection?.PrimaryId == primary.Id ? connection : null;
            Save(new(refreshToken, busy, now, primary.Id, familyId,
                previous?.PublicationMarker ?? "PaCT " + Guid.NewGuid().ToString("N"), previous?.PublicationCalendarId));
            accessToken = token.Value;
            accessExpiresAt = token.ExpiresAt;
            checkedThrough = through;
            nextCheck = now.AddSeconds(45);
            Volatile.Write(ref snapshot, new(busy, now, true, false, FamilyIncluded: familyId is not null));
        }
        catch (Exception error) when (!ct.IsCancellationRequested && IsUnavailable(error))
        {
            if (error is GoogleCalendarRequestRejected rejected) step = rejected.Step;
            throw new GoogleCalendarLinkFailure(step, error);
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
                var busy = await GetBusyAsync(client, accessToken, now, through, connection.FamilyId, ct);
                checkedThrough = through;
                nextCheck = now.AddSeconds(45);
                Volatile.Write(ref snapshot, Current with { Busy = busy, CheckedAt = now, Unavailable = false });
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

    private static bool IsFamilyCalendar(string? name) =>
        string.Equals(name?.Trim(), "Família", StringComparison.OrdinalIgnoreCase)
        || string.Equals(name?.Trim(), "Family", StringComparison.OrdinalIgnoreCase);

    private static async Task<AvailabilityRange[]> GetBusyAsync(HttpClient client, string token, DateTimeOffset now, DateTimeOffset through,
        string? familyId, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(client.Timeout);
        var blocks = new List<BusyInterval>();
        var start = AgendaRules.Midnight(AgendaRules.LocalDate(now)).ToUniversalTime();
        while (start < through)
        {
            var end = start.AddDays(FreeBusyWindowDays);
            if (end > through) end = through;
            blocks.AddRange(await QueryBusyWindowAsync(client, token, start, end, familyId, deadline.Token));
            start = end;
        }

        var busy = new List<AvailabilityRange>();
        foreach (var block in blocks.Where(block => block.End > now).OrderBy(block => block.Start))
        {
            if (busy.Count == 0 || block.Start > busy[^1].EndsAt)
                busy.Add(new(block.Start.ToUniversalTime(), block.End.ToUniversalTime()));
            else if (block.End > busy[^1].EndsAt) busy[^1] = busy[^1] with { EndsAt = block.End.ToUniversalTime() };
        }
        return busy.ToArray();
    }

    private static async Task<BusyInterval[]> QueryBusyWindowAsync(HttpClient client, string token, DateTimeOffset start, DateTimeOffset end,
        string? familyId, CancellationToken ct)
    {
        var body = JsonSerializer.Serialize(new
        {
            timeMin = start.UtcDateTime,
            timeMax = end.UtcDateTime,
            items = (familyId is null ? ["primary"] : new[] { "primary", familyId }).Select(id => new { id })
        });
        using var request = new HttpRequestMessage(HttpMethod.Post, FreeBusyEndpoint)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await client.SendAsync(request, ct);
        if (response.StatusCode == HttpStatusCode.BadRequest)
            throw new GoogleCalendarRequestRejected(await RejectedRequestStepAsync(response.Content, ct));
        response.EnsureSuccessStatusCode();
        var data = await response.Content.ReadFromJsonAsync<FreeBusy>(cancellationToken: ct);
        if (data?.Calendars is not { } calendars || calendars.Count != (familyId is null ? 1 : 2)
            || familyId is not null && !calendars.ContainsKey(familyId)
            || calendars.Values.Any(calendar => calendar is not { Errors: null or { Length: 0 }, Busy: { } blocks }
                || blocks.Any(block => block.End <= block.Start)))
            throw new JsonException("Não foi possível verificar os períodos ocupados.");
        return calendars.Values.SelectMany(calendar => calendar.Busy!).ToArray();
    }

    private static async Task<string> RejectedRequestStepAsync(HttpContent content, CancellationToken ct)
    {
        try
        {
            var envelope = await content.ReadFromJsonAsync<ErrorEnvelope>(cancellationToken: ct);
            foreach (var issue in envelope?.Error?.Errors ?? [])
            {
                if (issue is { Reason: "timeRangeEmpty" } or { Location: "timeMin" or "timeMax" })
                    return "periodo-calendario";
                if (issue is { Location: "items" or "items[0].id" })
                    return "id-calendario";
            }
        }
        catch (JsonException) { }
        return "pedido-calendario";
    }

    private sealed record ErrorEnvelope(CalendarError? Error);
    private sealed record CalendarError(CalendarIssue[]? Errors);
    private sealed record CalendarIssue(string? Reason, string? Location);

    private sealed record Token(
        [property: System.Text.Json.Serialization.JsonPropertyName("access_token")] string Value,
        [property: System.Text.Json.Serialization.JsonPropertyName("expires_in")] int Lifetime);
    private sealed record FreeBusy(Dictionary<string, Calendar>? Calendars);
    private sealed record Calendar(BusyInterval[]? Busy, JsonElement[]? Errors);
    private sealed record BusyInterval(DateTimeOffset Start, DateTimeOffset End);
}
