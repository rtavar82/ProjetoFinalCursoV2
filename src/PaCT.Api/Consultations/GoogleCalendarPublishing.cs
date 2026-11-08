using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;

namespace PaCT.Api.Consultations;

internal sealed record GoogleCalendarBooking(string Id, DateTimeOffset StartsAt, DateTimeOffset EndsAt,
    string ServiceTitle, string Modality, string? ClientName, string? Phone, string? Email, string? EventLocation = null);

public sealed partial class GoogleCalendarAvailability
{
    private const string CalendarEndpoint = "https://www.googleapis.com/calendar/v3/";
    private readonly SemaphoreSlim publicationRequested = new(0, 1);
    private sealed record CalendarListItem(string? Id, string? Summary, string? SummaryOverride, string? Description, bool Primary, string? AccessRole);
    private sealed record CalendarListPage(CalendarListItem[]? Items, string? NextPageToken);
    private sealed record PublishedTime(DateTimeOffset? DateTime);
    private sealed record PublishedEvent(string? Id, string? Summary, string? Description, string? Visibility, string? Transparency,
        PublishedTime? Start, PublishedTime? End, string? Location);
    private sealed record PublishedEventPage(PublishedEvent[]? Items, string? NextPageToken);

    internal void RequestPublication()
    {
        lock (publicationRequested)
        {
            if (publicationRequested.CurrentCount == 0) publicationRequested.Release();
        }
    }

    internal Task<bool> WaitForPublicationAsync(TimeSpan interval, CancellationToken ct) =>
        publicationRequested.WaitAsync(interval, ct);

    internal async Task PublishBookingsAsync(
        Func<DateTimeOffset, CancellationToken, Task<GoogleCalendarBooking[]>> readBookings, CancellationToken ct)
    {
        if (!settings.Configured || !Current.Connected || Current.NeedsReconnect) return;
        var observed = Volatile.Read(ref connection);
        if (observed?.PublicationMarker is null) return;
        var now = time.GetUtcNow();
        var bookings = await readBookings(now, ct);

        await gate.WaitAsync(ct);
        try
        {
            var linked = connection;
            if (linked is null || linked.PublicationMarker != observed.PublicationMarker) return;
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
            deadline.CancelAfter(TimeSpan.FromSeconds(10));
            var token = deadline.Token;
            using var client = clients.CreateClient(Client);
            var access = await GetAccessAsync(client, linked, token);
            var calendarId = linked.PublicationCalendarId ?? await FindOrCreatePublicationCalendarAsync(client, access.Value, linked, token);
            var eventsUrl = CalendarEndpoint + "calendars/" + Uri.EscapeDataString(calendarId) + "/events";
            var future = bookings.Where(booking => booking.StartsAt > time.GetUtcNow()).ToArray();
            await ReconcilePublicationsAsync(client, access.Value, eventsUrl, future, now, token);
            Volatile.Write(ref snapshot, Current with { PublishedAt = time.GetUtcNow(), PublicationUnavailable = false });
        }
        catch (Exception error) when (!ct.IsCancellationRequested && IsUnavailable(error))
        {
            if (!Current.PublicationUnavailable)
                logger.LogWarning("Publicação no Google Calendar temporariamente indisponível ({ErrorType}, HTTP {Status}).",
                    error.GetType().Name, (int?)(error as HttpRequestException)?.StatusCode);
            Volatile.Write(ref snapshot, Current with { PublicationUnavailable = true });
        }
        finally { gate.Release(); }
    }

    private static string PublicationId(string bookingId) =>
        "pact" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(bookingId)));

    private static string BookingTitle(GoogleCalendarBooking booking)
    {
        if (booking.EventLocation is not null) return booking.ServiceTitle;

        var names = (booking.ClientName ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var initials = names.Length switch
        {
            0 => "",
            1 => StringInfo.GetNextTextElement(names[0]).ToUpperInvariant(),
            _ => (StringInfo.GetNextTextElement(names[0]) + StringInfo.GetNextTextElement(names[^1])).ToUpperInvariant()
        };
        var modality = booking.Modality switch { "InPerson" => "Pres.", "Remote" => "Onl.", _ => "" };
        return string.Join(" · ", new[] { initials, ShortServiceTitle(booking.ServiceTitle), modality }
            .Where(part => part.Length > 0));
    }

    private static string ShortServiceTitle(string title)
    {
        var name = title.Trim() switch
        {
            "Sessão de Reiki & Alinhamento Energético" => "Reiki",
            "Consultas \"Sentir Além do Olhar\"" or "Consultas “Sentir Além do Olhar”" => "Sentir Além",
            "Sessão Individual de Constelação Familiar" => "Const. Familiar",
            var custom => custom
        };
        const int maxLength = 28;
        var text = new StringInfo(name);
        if (text.LengthInTextElements <= maxLength) return name;

        var prefix = text.SubstringByTextElements(0, maxLength);
        var lastSpace = name.LastIndexOf(' ', prefix.Length);
        return (lastSpace > 0 ? name[..lastSpace] : prefix).TrimEnd() + "…";
    }

    private static string BookingDescription(GoogleCalendarBooking booking)
    {
        var lines = new List<string>();
        void Add(string label, string? value)
        {
            if (!string.IsNullOrWhiteSpace(value)) lines.Add($"{label}: {WebUtility.HtmlEncode(value)}");
        }

        Add("Cliente", booking.ClientName);
        Add("Telefone", booking.Phone);
        Add("Email", booking.Email);
        Add(booking.EventLocation is null ? "Tipo de consulta" : "Evento", booking.ServiceTitle);
        Add("Modalidade", booking.Modality switch { "InPerson" => "Presencial", "Remote" => "Online", _ => booking.Modality });
        return string.Join("<br>", lines);
    }

    private static async Task<CalendarListItem[]> ListCalendarsAsync(HttpClient client, string access, CancellationToken ct)
    {
        var calendars = new List<CalendarListItem>();
        var url = CalendarEndpoint + "users/me/calendarList?showHidden=true&maxResults=250";
        string? next = null;
        do
        {
            using var response = await SendAsync(client, access, HttpMethod.Get, PageUrl(url, next), null, ct);
            var page = await response.Content.ReadFromJsonAsync<CalendarListPage>(cancellationToken: ct)
                ?? throw new JsonException("Lista de calendários em falta.");
            calendars.AddRange(page.Items ?? []);
            next = page.NextPageToken;
        } while (!string.IsNullOrEmpty(next));
        return calendars.ToArray();
    }

    private async Task<string> FindOrCreatePublicationCalendarAsync(HttpClient client, string access, Connection linked, CancellationToken ct)
    {
        var calendars = await ListCalendarsAsync(client, access, ct);
        var existing = calendars.FirstOrDefault(calendar => calendar.AccessRole == "owner" && !calendar.Primary
            && calendar.Description == linked.PublicationMarker && calendar.Id is { Length: > 0 });
        var id = existing?.Id;
        if (id is null)
        {
            using var response = await SendAsync(client, access, HttpMethod.Post, CalendarEndpoint + "calendars",
                new { summary = "PaCT", description = linked.PublicationMarker, timeZone = "Europe/Lisbon" }, ct);
            id = (await response.Content.ReadFromJsonAsync<CalendarListItem>(cancellationToken: ct))?.Id;
            if (string.IsNullOrWhiteSpace(id)) throw new JsonException("O calendário criado não devolveu uma referência.");
        }
        Save(linked with { PublicationCalendarId = id });
        return id;
    }

    private static async Task ReconcilePublicationsAsync(HttpClient client, string access, string url, GoogleCalendarBooking[] bookings,
        DateTimeOffset now, CancellationToken ct)
    {
        var saved = new Dictionary<string, PublishedEvent>(StringComparer.Ordinal);
        var query = QueryHelpers.AddQueryString(url, new Dictionary<string, string?>
        {
            ["privateExtendedProperty"] = "pact=booking", ["timeMin"] = now.UtcDateTime.ToString("O", CultureInfo.InvariantCulture),
            ["maxResults"] = "2500"
        });
        string? next = null;
        do
        {
            using var response = await SendAsync(client, access, HttpMethod.Get, PageUrl(query, next), null, ct);
            var page = await response.Content.ReadFromJsonAsync<PublishedEventPage>(cancellationToken: ct)
                ?? throw new JsonException("Lista de marcações em falta.");
            foreach (var item in page.Items ?? [])
                if (item.Id is { Length: > 0 } id && id.StartsWith("pact", StringComparison.Ordinal)) saved[id] = item;
            next = page.NextPageToken;
        } while (!string.IsNullOrEmpty(next));

        foreach (var booking in bookings.OrderBy(item => item.StartsAt))
        {
            var id = PublicationId(booking.Id);
            var summary = BookingTitle(booking);
            var description = BookingDescription(booking);
            var exists = saved.Remove(id, out var published);
            if (published is { Visibility: "private", Transparency: null or "opaque" }
                && published.Summary == summary && published.Description == description && published.Location == booking.EventLocation
                && published.Start?.DateTime == booking.StartsAt && published.End?.DateTime == booking.EndsAt) continue;
            var value = new
            {
                id, summary, description, location = booking.EventLocation, visibility = "private", transparency = "opaque",
                start = new { dateTime = booking.StartsAt.ToUniversalTime() },
                end = new { dateTime = booking.EndsAt.ToUniversalTime() },
                extendedProperties = new { @private = new { pact = "booking" } }
            };
            using var response = await SendAsync(client, access, exists ? HttpMethod.Put : HttpMethod.Post,
                exists ? url + "/" + id : url, value, ct);
        }

        foreach (var (id, item) in saved)
        {
            if (item.Start?.DateTime is not { } start || start <= now) continue;
            using var response = await SendAsync(client, access, HttpMethod.Delete, url + "/" + Uri.EscapeDataString(id), null, ct);
        }
    }

    private static string PageUrl(string url, string? next) =>
        string.IsNullOrEmpty(next) ? url : QueryHelpers.AddQueryString(url, "pageToken", next);

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, string access, HttpMethod method, string url, object? value, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", access);
        if (value is not null) request.Content = JsonContent.Create(value);
        var response = await client.SendAsync(request, ct);
        if (response.IsSuccessStatusCode || method == HttpMethod.Delete && response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
            return response;
        using (response) response.EnsureSuccessStatusCode();
        return response;
    }
}
