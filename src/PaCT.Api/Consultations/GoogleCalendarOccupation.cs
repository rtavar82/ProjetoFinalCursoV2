using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;

namespace PaCT.Api.Consultations;

internal sealed record GoogleAgendaEvent(string Id, string Title, string Calendar, DateTimeOffset StartsAt, DateTimeOffset EndsAt, bool BlocksTime);
internal sealed record GoogleOccupation(GoogleCalendarSnapshot Snapshot, GoogleAgendaEvent[] Events,
    bool TitlesUnavailable = false, bool NeedsTitlePermission = false);

public sealed partial class GoogleCalendarAvailability
{
    private sealed record OccupationTime(DateTimeOffset? DateTime, DateOnly? Date)
    {
        public DateTimeOffset? InCalendar(TimeZoneInfo zone)
        {
            if (DateTime is { } instant) return instant;
            if (Date is not { } day) return null;
            var midnight = day.ToDateTime(TimeOnly.MinValue);
            return new DateTimeOffset(midnight, zone.GetUtcOffset(midnight));
        }
    }
    private sealed record OccupationAttendee(bool Self, string? ResponseStatus);
    private sealed record OccupationEvent(string? Id, string? Summary, string? EventType, string? Status, string? Transparency,
        OccupationTime? Start, OccupationTime? End, OccupationAttendee[]? Attendees);
    private sealed record OccupationPage(OccupationEvent[]? Items, string? NextPageToken, string? TimeZone, string? AccessRole);
    private sealed record OccupationRead(GoogleAgendaEvent[] Events, bool Unavailable = false, bool Denied = false);

    internal async Task<GoogleOccupation> ReadOccupationAsync(DateTimeOffset start, DateTimeOffset end, CancellationToken ct)
    {
        if (!settings.Configured || !Current.Connected) return new(Current, []);
        using var client = clients.CreateClient(Client);
        Connection linked;
        AccessToken access;
        await gate.WaitAsync(ct);
        try
        {
            var current = connection;
            if (current?.PrimaryId is null) return new(Current, []);
            linked = current;
            access = await GetAccessAsync(client, linked, ct);
        }
        catch (Exception error) when (!ct.IsCancellationRequested && IsUnavailable(error))
        {
            return new(Current with
            {
                Unavailable = true,
                NeedsReconnect = error is HttpRequestException { StatusCode: HttpStatusCode.BadRequest or HttpStatusCode.Unauthorized }
            }, []);
        }
        finally { gate.Release(); }

        var results = await ReadCalendarOccupationsAsync(client, access, linked.PrimaryId!, linked.FamilyId,
            start, end, includeTitles: true, ct);
        var needsTitlePermission = access.CanReadEvents == false || results[0].Denied;
        var titlesUnavailable = needsTitlePermission || results.Any(result => result.Unavailable);
        AvailabilityRange[]? busy = [];
        if (titlesUnavailable)
        {
            try { busy = MergeBusy(await ReadFreeBusyInPeriodAsync(client, access.Value, start, end, linked.FamilyId, ct), start); }
            catch (Exception error) when (!ct.IsCancellationRequested && IsUnavailable(error)) { busy = null; }
        }
        await gate.WaitAsync(ct);
        try
        {
            // A connection replaced during the read must never contribute private event titles.
            if (connection?.RefreshToken != linked.RefreshToken || connection?.PrimaryId != linked.PrimaryId
                || connection?.FamilyId != linked.FamilyId)
                return new(Current, []);
            var state = Current;
            return new(state with { Busy = busy ?? state.Busy, Unavailable = busy is null },
                results.SelectMany(result => result.Events).ToArray(), titlesUnavailable, needsTitlePermission);
        }
        finally { gate.Release(); }
    }

    private static async Task<OccupationRead[]> ReadCalendarOccupationsAsync(HttpClient client, AccessToken access, string primaryId,
        string? familyId, DateTimeOffset start, DateTimeOffset end, bool includeTitles, CancellationToken ct)
    {
        if (access.CanReadEvents == false) return [];
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(5));
        var primary = ReadCalendarOccupationAsync(client, access.Value, primaryId, "Principal", start, end, includeTitles, deadline.Token, ct);
        if (familyId is null) return [await primary];
        var family = ReadCalendarOccupationAsync(client, access.Value, familyId, "Família", start, end, includeTitles, deadline.Token, ct);
        return await Task.WhenAll(primary, family);
    }

    private static async Task<OccupationRead> ReadCalendarOccupationAsync(HttpClient client, string access, string calendarId, string label,
        DateTimeOffset start, DateTimeOffset end, bool includeTitles, CancellationToken deadline, CancellationToken ct)
    {
        try
        {
            var endpoint = CalendarEndpoint + "calendars/" + Uri.EscapeDataString(calendarId) + "/events";
            var url = QueryHelpers.AddQueryString(endpoint, new Dictionary<string, string?>
            {
                ["timeMin"] = start.UtcDateTime.ToString("O", CultureInfo.InvariantCulture),
                ["timeMax"] = end.UtcDateTime.ToString("O", CultureInfo.InvariantCulture),
                ["singleEvents"] = "true",
                ["maxResults"] = "2500",
                ["fields"] = "nextPageToken,timeZone,accessRole,items(id,eventType,status,transparency,start(date,dateTime),end(date,dateTime),attendees(self,responseStatus)"
                    + (includeTitles ? ",summary)" : ")")
            });
            var events = new List<GoogleAgendaEvent>();
            var busyOnly = false;
            string? next = null;
            do
            {
                using var response = await SendAsync(client, access, HttpMethod.Get, PageUrl(url, next), null, deadline);
                var page = await response.Content.ReadFromJsonAsync<OccupationPage>(cancellationToken: deadline)
                    ?? throw new JsonException("Lista de eventos em falta.");
                if (page.AccessRole is "none" or "freeBusyReader") busyOnly = true;
                var zone = page.TimeZone is { } zoneId && TimeZoneInfo.TryFindSystemTimeZoneById(zoneId, out var sourceZone)
                    ? sourceZone : AgendaRules.Lisbon;
                foreach (var item in page.Items ?? [])
                {
                    if (item.Status == "cancelled" || string.IsNullOrWhiteSpace(item.Id)
                        || item.Attendees?.Any(a => a.Self && a.ResponseStatus == "declined") == true
                        || item.Start?.InCalendar(zone) is not { } from || item.End?.InCalendar(zone) is not { } to
                        || from >= to || !AgendaRules.Overlaps(start, end, from, to)) continue;
                    // Regular commitments on the linked calendars also block PaCT when Google marks them as available.
                    var blocksTime = item.Transparency != "transparent" || (!busyOnly && item.EventType is null or "default");
                    if (busyOnly && !blocksTime) continue;
                    var title = string.IsNullOrWhiteSpace(item.Summary) ? (blocksTime ? "Ocupado" : "Evento Google") : item.Summary;
                    events.Add(new(label + ":" + item.Id, title, label, from, to, blocksTime));
                }
                next = page.NextPageToken;
            } while (!string.IsNullOrEmpty(next));
            return new(events.ToArray(), Unavailable: busyOnly, Denied: busyOnly);
        }
        catch (Exception error) when (!ct.IsCancellationRequested && IsUnavailable(error))
        {
            return new([], Unavailable: true, Denied: error is HttpRequestException { StatusCode: HttpStatusCode.Forbidden });
        }
    }
}
