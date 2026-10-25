using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public static class AgendaRules
{
    public static readonly TimeZoneInfo Lisbon = TimeZoneInfo.FindSystemTimeZoneById("Europe/Lisbon");
    public static IEnumerable<AvailabilityWindow> ActiveWindows(ConsultationData data) => data.Windows.Where(w => w.RetiredAt is null);
    public static bool Overlaps(DateTimeOffset start, DateTimeOffset end, DateTimeOffset otherStart, DateTimeOffset otherEnd) => start < otherEnd && otherStart < end;
    public static DateTimeOffset Midnight(DateOnly date) => new(TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(TimeOnly.MinValue), Lisbon));
    public static DateOnly LocalDate(DateTimeOffset instant) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, Lisbon).DateTime);
    public static DateTimeOffset HorizonEndExclusive(DateTimeOffset now) => Midnight(LocalDate(now).AddMonths(6).AddDays(1));
    public static bool IsBookableStart(DateTimeOffset start, DateTimeOffset now) => start > now && start < HorizonEndExclusive(now);
    private static void Require(bool valid, string message, int status = 400) { if (!valid) throw new IdentityProblem(status, message); }

    public static string Revision(ConsultationData data)
    {
        // Include occupation versions: a review cannot authorize changes against an older booking.
        var parts = data.Windows.OrderBy(w => w.Id, StringComparer.Ordinal).Select(w => $"w:{w.Id}:{w.Version}")
            .Concat(ActivityCatalogue.Complete(data.Services).OrderBy(s => s.Id, StringComparer.Ordinal).Select(s => $"s:{s.Id}:{s.Version}"))
            .Concat(data.Consultations.OrderBy(c => c.Id, StringComparer.Ordinal).Select(c => $"c:{c.Id}:{c.Version}"))
            .Concat(data.GuestRequests.OrderBy(c => c.Id, StringComparer.Ordinal).Select(c => $"g:{c.Id}:{c.Version}"))
            .Concat(data.Events.OrderBy(e => e.Id, StringComparer.Ordinal).Select(e => $"e:{e.Id}:{e.Version}"));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join('\n', parts))));
    }

    public static void ValidateWindow(DateTimeOffset start, DateTimeOffset end, DateTimeOffset now)
    {
        var localDay = start == Midnight(LocalDate(start)) && end == Midnight(LocalDate(start).AddDays(1));
        Require(start > now && end > start && (end - start <= TimeSpan.FromHours(24) || localDay), "Indica um intervalo futuro até 24 horas.");
    }

    public static bool EligibleWindow(AvailabilityWindow window, bool registered) => window.Rules?.Audience != "Registered" || registered;
    public static bool Matches(AvailabilityWindow window, ConsultationService service) => window.Rules is not { } r
        || (r.ServiceId is null || r.ServiceId == service.Id) && (r.Modality is null || r.Modality == service.Modality)
        && (r.PublicLocation is null || r.PublicLocation == service.PublicLocation);
    public static bool Allows(ConsultationData data, ConsultationService service, DateTimeOffset start, DateTimeOffset end, bool registered)
    {
        var windows = ActiveWindows(data).Where(w => w.Available && EligibleWindow(w, registered) && Matches(w, service)).ToArray();
        if (windows.Any(w => w.Rules is { } r && start >= w.StartsAt && start < w.EndsAt && start <= r.LastStartAt
            && (start == (r.FirstStartAt ?? w.StartsAt) || (start - (r.FirstStartAt ?? w.StartsAt)).TotalMinutes % 30 == 0))) return true;
        var coverage = new ConsultationData(); coverage.Windows.AddRange(windows.Where(w => w.Rules is null));
        return Covers(coverage, start, end);
    }

    public static void ValidateRules(ConsultationData data, AvailabilitySlice window)
    {
        if (window.Rules is not { } r) return;
        Require(window.Available && r.LastStartAt >= window.StartsAt && r.LastStartAt < window.EndsAt
            && (r.FirstStartAt is null || r.FirstStartAt == window.StartsAt), "Revê o primeiro e o último início permitido.");
        Require(r.Audience is "All" or "Registered" && r.Modality is null or "InPerson" or "Remote"
            && (r.PublicLocation is null || r.PublicLocation.Length is > 0 and <= 300)
            && !(r.Modality == "Remote" && r.PublicLocation is not null), "Revê a visibilidade, modalidade e local.");
        var services = data.Services.Where(s => s.Active && s.ServiceKind is null && (r.ServiceId is null || s.Id == r.ServiceId)).ToArray();
        Require(r.ServiceId is null || services.Length == 1, "Seleciona uma consulta individual ativa.");
        if (r.Modality is not null || r.PublicLocation is not null)
            Require(services.SelectMany(s => ClientBooking.Options(s).Select(o => ClientBooking.Snapshot(s, o)))
                .Any(s => (r.Modality is null || s.Modality == r.Modality) && (r.PublicLocation is null || s.PublicLocation == r.PublicLocation)),
                "A combinação de consulta, modalidade e local não está publicada.");
    }

    public static bool Covers(ConsultationData data, DateTimeOffset start, DateTimeOffset end)
    {
        var coveredUntil = start;
        foreach (var window in ActiveWindows(data).Where(w => w.Available && Overlaps(start, end, w.StartsAt, w.EndsAt)).OrderBy(w => w.StartsAt))
        {
            if (window.StartsAt > coveredUntil) return false;
            if (window.EndsAt > coveredUntil) coveredUntil = window.EndsAt;
            if (coveredUntil >= end) return true;
        }
        return false;
    }

    public static void ValidateOccupation(ConsultationData data, DateTimeOffset start, DateTimeOffset end, DateTimeOffset now, string? excludingId = null, string? excludingGuestId = null, string? excludingEventId = null)
    {
        Require(!data.Consultations.Any(c => c.Id != excludingId && ConsultationRules.Occupies(c, now)
            && Overlaps(start, end.AddMinutes(30), c.StartsAt, c.EndsAt.AddMinutes(30))),
            "O horário está ocupado, incluindo o intervalo de recuperação.", 409);
        Require(!data.GuestRequests.Any(g => g.Id != excludingGuestId && GuestConsultations.Occupies(g, now)
            && Overlaps(start, end.AddMinutes(30), g.StartsAt, g.EndsAt.AddMinutes(30))), "Este horário está ocupado por um pedido em análise.", 409);
        Require(!data.Events.Any(e => e.Id != excludingEventId && GroupEvents.Occupies(e)
            && Overlaps(start, end.AddMinutes(30), e.Definition.StartsAt, e.Definition.EndsAt.AddMinutes(30))), "O horário está ocupado por um grupo ou retiro.", 409);
    }

    public static AgendaPublicationPreview Preview(ConsultationData data, AvailabilityPublication publication, DateTimeOffset now)
    {
        Require(publication.Revision == Revision(data), "A agenda mudou. Revê os intervalos antes de publicar.", 409);
        Require(publication.EndsAt > publication.StartsAt, "Indica o período a substituir.");
        var start = publication.ReplaceWholeDays ? Midnight(LocalDate(publication.StartsAt)) : publication.StartsAt.ToUniversalTime();
        var end = publication.EndsAt.ToUniversalTime();
        if (publication.ReplaceWholeDays && end != Midnight(LocalDate(end))) end = Midnight(LocalDate(end).AddDays(1));
        Require((publication.SelectedDays is null ? start > now : start >= Midnight(LocalDate(now))) && end > start && end <= HorizonEndExclusive(now).AddDays(1), "Indica um período futuro dentro do horizonte da agenda.");
        Require(publication.Windows is not null && publication.Windows.Length <= 512 && publication.Windows.All(w => w is not null), "Indica até 512 intervalos para publicar.");
        var slices = publication.Windows!.OrderBy(w => w.StartsAt).ToArray();
        for (var i = 0; i < slices.Length; i++)
        {
            var window = slices[i];
            if (!window.Available && publication.SelectedDays is not null && window.StartsAt == Midnight(LocalDate(now)) && window.EndsAt == Midnight(LocalDate(now).AddDays(1))) { }
            else ValidateWindow(window.StartsAt, window.EndsAt, now);
            ValidateRules(data, window);
            Require(window.StartsAt >= start && window.EndsAt <= end, "Os intervalos devem pertencer ao período revisto.");
            Require(i == 0 || slices[i - 1].EndsAt <= window.StartsAt, "Os intervalos da publicação não podem sobrepor-se.");
        }
        var ranges = ReplacementRanges(publication, start, end, now);
        bool Touches(DateTimeOffset first, DateTimeOffset last) => ranges.Any(r => Overlaps(r.StartsAt, r.EndsAt, first, last));
        var affected = ActiveWindows(data).Where(w => Touches(w.StartsAt, w.EndsAt)).ToArray();
        var conflicts = data.Consultations.Where(c => ConsultationRules.Occupies(c, now) && Touches(c.StartsAt, c.EndsAt.AddMinutes(30)))
            .Select(c => new AgendaConflict(c.Id, c.StartsAt, c.EndsAt, ConsultationRules.State(c, now)))
            .Concat(data.GuestRequests.Where(g => GuestConsultations.Occupies(g, now) && Touches(g.StartsAt, g.EndsAt.AddMinutes(30)))
                .Select(g => new AgendaConflict(g.Id, g.StartsAt, g.EndsAt, "GuestRequest")))
            .Concat(data.Events.Where(e => GroupEvents.Occupies(e) && Touches(e.Definition.StartsAt, e.Definition.EndsAt.AddMinutes(30)))
                .Select(e => new AgendaConflict(e.Id, e.Definition.StartsAt, e.Definition.EndsAt, "Event")))
            .OrderBy(c => c.StartsAt).ThenBy(c => c.Id).ToArray();
        return new(publication.Revision, start, end, affected.Length,
            affected.Sum(w => Remainders(w, ranges).Count()), conflicts, ranges);
    }

    private static AvailabilityRange[] ReplacementRanges(AvailabilityPublication p, DateTimeOffset start, DateTimeOffset end, DateTimeOffset now)
    {
        if (p.SelectedDays is null) return [new(start, end)];
        Require(p.SelectedDays.Length is > 0 and <= 190 && p.SelectedDays.Distinct().Count() == p.SelectedDays.Length, "Assinala os dias a alterar.");
        var dates = p.SelectedDays.Select(day => DateOnly.TryParseExact(day, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date : throw new IdentityProblem(400, "Indica dias válidos.")).Order().ToArray();
        Require(dates.All(d => d >= LocalDate(now) && Midnight(d) >= start && Midnight(d) < end && Midnight(d) < HorizonEndExclusive(now)), "Assinala dias dentro do período e do horizonte da agenda.");
        Require(p.Windows.Length == dates.Length && dates.All(d => p.Windows.Count(w => LocalDate(w.StartsAt) == d) == 1), "Cada dia assinalado deve ter exatamente um intervalo revisto.");
        Require(p.Windows.All(w => w.EndsAt <= Midnight(LocalDate(w.StartsAt).AddDays(1))), "Os intervalos devem pertencer aos dias assinalados.");
        return dates.Select(d => p.ReplaceWholeDays ? new AvailabilityRange(Midnight(d), Midnight(d.AddDays(1)))
            : new AvailabilityRange(p.Windows.Single(w => LocalDate(w.StartsAt) == d).StartsAt, p.Windows.Single(w => LocalDate(w.StartsAt) == d).EndsAt)).ToArray();
    }
    private static IEnumerable<AvailabilityRange> Remainders(AvailabilityWindow window, AvailabilityRange[] ranges)
    {
        var cursor = window.StartsAt;
        foreach (var range in ranges.Where(r => Overlaps(r.StartsAt, r.EndsAt, window.StartsAt, window.EndsAt)).OrderBy(r => r.StartsAt))
        {
            if (range.StartsAt > cursor) yield return new(cursor, range.StartsAt);
            if (range.EndsAt > cursor) cursor = range.EndsAt;
        }
        if (cursor < window.EndsAt) yield return new(cursor, window.EndsAt);
    }

    public static ConsultationResult Publish(ConsultationData data, AvailabilityPublication publication, ConsultationActor actor, string operationId, DateTimeOffset now)
    {
        Require(actor.IsManager, "Esta ação exige a gestora-terapeuta.", 403);
        var preview = Preview(data, publication, now);
        Require(preview.Conflicts.Length == 0 || publication.ConfirmConflicts,
            "O período inclui marcações existentes. Revê os conflitos e confirma que as marcações serão mantidas.", 409);
        // Validate everything before changing the aggregate. The store commits the entire publication once.
        var ranges = preview.Ranges!;
        foreach (var old in ActiveWindows(data).Where(w => ranges.Any(r => Overlaps(r.StartsAt, r.EndsAt, w.StartsAt, w.EndsAt))).ToArray())
        {
            var index = data.Windows.FindIndex(w => w.Id == old.Id);
            data.Windows[index] = old with { RetiredAt = now, Version = old.Version + 1, ChangedBy = actor.AccountId, PublicationId = operationId };
            foreach (var rest in Remainders(old, ranges))
            {
                var rules = old.Rules is null ? null : old.Rules with { LastStartAt = old.Rules.LastStartAt < rest.EndsAt ? old.Rules.LastStartAt : rest.EndsAt.AddMinutes(-1) };
                if (rules is not null && rules.LastStartAt < rest.StartsAt) continue;
                Add(rest.StartsAt, rest.EndsAt, old.Available, old.Id, rules);
            }
        }
        foreach (var slice in publication.Windows) Add(slice.StartsAt.ToUniversalTime(), slice.EndsAt.ToUniversalTime(), slice.Available, null,
            slice.Rules is null ? null : slice.Rules with { FirstStartAt = slice.StartsAt.ToUniversalTime() });
        return new(operationId, "Agenda publicada. As marcações existentes foram mantidas.");
        void Add(DateTimeOffset start, DateTimeOffset end, bool available, string? source, AvailabilityConstraints? rules) => data.Windows.Add(new(
            Guid.NewGuid().ToString(), start, end, available, ChangedBy: actor.AccountId, PublicationId: operationId, SourceWindowId: source, Rules: rules));
    }

    public static (DateTimeOffset Start, DateTimeOffset End) MonthRange(string? month, DateTimeOffset now)
    {
        var date = LocalDate(now);
        var first = new DateOnly(date.Year, date.Month, 1);
        if (month is not null)
        {
            Require(month.Length == 7 && DateOnly.TryParseExact(month + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _), "Indica o mês no formato AAAA-MM.");
            first = DateOnly.ParseExact(month + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture);
        }
        Require(first.Year < 9999, "Mês fora do horizonte da agenda.");
        var start = Midnight(first); var end = Midnight(first.AddMonths(1));
        Require(end > now && start < HorizonEndExclusive(now), "Mês fora do horizonte da agenda.");
        return (start < now ? now : start, end > HorizonEndExclusive(now) ? HorizonEndExclusive(now) : end);
    }

    public static PublicAgendaSegment[] PublicSegments(ConsultationData data, DateTimeOffset start, DateTimeOffset end, DateTimeOffset now, bool registered = true)
    {
        var intervals = ActiveWindows(data).Where(w => Overlaps(start, end, w.StartsAt, w.EndsAt) && (!w.Available || EligibleWindow(w, registered)))
            .Select(w => new PublicAgendaSegment(w.StartsAt, w.EndsAt, w.Available ? "Available" : "Blocked"))
            .Concat(data.Consultations.Where(c => ConsultationRules.Occupies(c, now) && Overlaps(start, end, c.StartsAt, c.EndsAt.AddMinutes(30)))
                .Select(c => new PublicAgendaSegment(c.StartsAt, c.EndsAt.AddMinutes(30), c.KeepBlocked && c.State is "CancelledClient" or "CancelledManager" ? "Blocked" : "Occupied")))
            .Concat(data.GuestRequests.Where(g => GuestConsultations.Occupies(g, now) && Overlaps(start, end, g.StartsAt, g.EndsAt.AddMinutes(30)))
                .Select(g => new PublicAgendaSegment(g.StartsAt, g.EndsAt.AddMinutes(30), "Occupied")))
            .Concat(data.Events.Where(e => GroupEvents.Occupies(e) && Overlaps(start, end, e.Definition.StartsAt, e.Definition.EndsAt.AddMinutes(30)))
                .Select(e => new PublicAgendaSegment(e.Definition.StartsAt, e.Definition.EndsAt.AddMinutes(30), e.State == "Cancelled" ? "Blocked" : "Occupied"))).ToArray();
        var events = intervals.SelectMany(x => new[] {
            (At: x.StartsAt < start ? start : x.StartsAt, x.State, Delta: 1),
            (At: x.EndsAt > end ? end : x.EndsAt, x.State, Delta: -1) })
            .Append((At: start, State: "Unavailable", Delta: 0)).Append((At: end, State: "Unavailable", Delta: 0));
        var result = new List<PublicAgendaSegment>();
        var counts = new Dictionary<string, int> { ["Available"] = 0, ["Blocked"] = 0, ["Occupied"] = 0, ["Unavailable"] = 0 };
        var previous = start;
        foreach (var group in events.GroupBy(x => x.At).OrderBy(x => x.Key))
        {
            if (group.Key > previous)
            {
                var state = counts["Occupied"] > 0 ? "Occupied" : counts["Blocked"] > 0 ? "Blocked" : counts["Available"] > 0 ? "Available" : "Unavailable";
                if (result.Count > 0 && result[^1].State == state) result[^1] = result[^1] with { EndsAt = group.Key };
                else result.Add(new(previous, group.Key, state));
            }
            foreach (var entry in group) counts[entry.State] += entry.Delta;
            previous = group.Key;
        }
        return result.ToArray();
    }
}
