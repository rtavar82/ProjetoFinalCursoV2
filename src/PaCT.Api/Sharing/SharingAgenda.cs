using System.Globalization;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Sharing;

public sealed record AgendaShareTarget(string Kind, string Title, DateTimeOffset StartsAt, string? Location,
    string? EventId = null, string? ServiceId = null, string? WindowId = null);

public sealed class SharingAgenda(IConsultationStore store, TimeProvider time)
{
    public static string? Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var parts = value.Trim().Split('@');
        if (parts.Length <= 2 && Guid.TryParseExact(parts[0], "D", out var id))
        {
            if (parts.Length == 1) return id.ToString();
            if (long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var unix)
                && unix is >= 0 and <= 253402300799)
                return $"{id}@{unix}";
        }
        throw new IdentityProblem(400, "A referência da Agenda não é válida.");
    }

    public async Task<AgendaShareTarget> FindAsync(string reference, bool registered, CancellationToken ct)
    {
        var key = Normalize(reference) ?? throw new IdentityProblem(400, "Indica a referência da Agenda.");
        var now = time.GetUtcNow();
        return await store.ReadAgendaAsync(data =>
        {
            var parts = key.Split('@');
            if (parts.Length == 1)
            {
                var item = data.Events.FirstOrDefault(e => e.Id == key && e.Definition.Published && e.State == "Waiting"
                    && AgendaRules.IsBookableStart(e.Definition.StartsAt, now));
                return item is null ? throw new IdentityProblem(404, "Evento indisponível.") :
                    new AgendaShareTarget("event", item.Service.Title, item.Definition.StartsAt, item.Definition.PublicLocation, item.Id, item.Service.Id);
            }

            var start = DateTimeOffset.FromUnixTimeSeconds(long.Parse(parts[1], CultureInfo.InvariantCulture));
            var window = AgendaRules.ActiveWindows(data).FirstOrDefault(w => w.Id == parts[0] && w.Available
                && AgendaRules.EligibleWindow(w, registered) && start >= w.StartsAt && start < w.EndsAt);
            if (window is null || !AgendaRules.IsBookableStart(start, now))
                throw new IdentityProblem(404, "Horário indisponível.");

            if (AgendaRules.Lisbon.IsAmbiguousTime(TimeZoneInfo.ConvertTime(start, AgendaRules.Lisbon).DateTime))
                throw new IdentityProblem(404, "Horário indisponível.");

            var halfHour = TimeSpan.FromMinutes(30).Ticks;
            if (window.Rules is { } rules)
            {
                var first = rules.FirstStartAt ?? window.StartsAt;
                if (start < first || start > rules.LastStartAt || (start - first).Ticks % halfHour != 0)
                    throw new IdentityProblem(404, "Horário indisponível.");
            }
            else
            {
                var first = new[] { window.StartsAt, AgendaRules.Midnight(AgendaRules.LocalDate(start)), now.AddMilliseconds(1) }.Max();
                var minute = TimeSpan.FromMinutes(1).Ticks;
                var firstMinute = (first.UtcTicks + minute - 1) / minute * minute;
                if (start.UtcTicks != firstMinute && start.UtcTicks % halfHour != 0)
                    throw new IdentityProblem(404, "Horário indisponível.");
            }

            var variants = ActivityCatalogue.Complete(data.Services).Where(s => s.Active && s.ServiceKind is null)
                .SelectMany(s => ClientBooking.Options(s, data.PublishedSite).Select(option => ClientBooking.Snapshot(s, option)))
                .Where(s => AgendaRules.Matches(window, s));
            foreach (var variant in variants)
            {
                var end = start.AddMinutes(variant.DurationMinutes);
                if (window.Rules is null && end > window.EndsAt) continue;
                if (AgendaRules.PublicSegments(data, start, end.AddMinutes(30), now, registered).Any(segment => segment.State == "Blocked")) continue;
                try { AgendaRules.ValidateOccupation(data, start, end, now); }
                catch (IdentityProblem error) when (error.Status == 409) { continue; }
                var title = window.Rules?.ServiceId is null ? "Horário livre" : variant.Title;
                return new AgendaShareTarget("slot", title, start, window.Rules?.PublicLocation, WindowId: window.Id);
            }
            throw new IdentityProblem(404, "Horário indisponível.");
        }, ct);
    }
}