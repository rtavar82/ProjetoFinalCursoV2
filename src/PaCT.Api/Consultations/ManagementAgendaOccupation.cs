namespace PaCT.Api.Consultations;

internal sealed record AgendaOccupationBlock(string Id, string Kind, string Title, DateTimeOffset StartsAt, DateTimeOffset EndsAt,
    string? Calendar = null, bool Overlap = false, bool BlocksTime = true);

internal static class ManagementAgendaOccupation
{
    internal static AgendaOccupationBlock[] Pact(ConsultationData data, DateTimeOffset start, DateTimeOffset end, DateTimeOffset now)
    {
        var blocks = new List<AgendaOccupationBlock>();
        void Add(string id, string kind, string title, DateTimeOffset from, DateTimeOffset to, bool recovery)
        {
            if (AgendaRules.Overlaps(start, end, from, to)) blocks.Add(new(id, kind, title, from, to));
            if (recovery && AgendaRules.Overlaps(start, end, to, to.AddMinutes(30)))
                blocks.Add(new(kind + ":" + id + ":recovery", "Recovery", "Intervalo de recuperação", to, to.AddMinutes(30)));
        }

        foreach (var window in AgendaRules.ActiveWindows(data).Where(w => !w.Available))
            Add(window.Id, "Blocked", "Horário bloqueado", window.StartsAt, window.EndsAt, false);
        foreach (var booking in data.Consultations.Where(c => ConsultationRules.Occupies(c, now)))
            Add(booking.Id, "Consultation", booking.Service.Title, booking.StartsAt, booking.EndsAt, true);
        foreach (var request in data.GuestRequests.Where(g => GuestConsultations.Occupies(g, now)))
            Add(request.Id, "Guest", request.Service.Title, request.StartsAt, request.EndsAt, true);
        foreach (var item in data.Events.Where(GroupEvents.Occupies))
            Add(item.Id, "Event", item.Service.Title, item.Definition.StartsAt, item.Definition.EndsAt, true);
        return blocks.ToArray();
    }

    internal static AgendaOccupationBlock[] Combine(AgendaOccupationBlock[] pact, GoogleOccupation google, DateTimeOffset start, DateTimeOffset end)
    {
        var events = google.Events.Where(item => AgendaRules.Overlaps(start, end, item.StartsAt, item.EndsAt))
            .OrderBy(item => item.StartsAt).ToArray();
        var blocks = events.Select(item => new AgendaOccupationBlock(item.Id, "Google", item.Title,
            item.StartsAt, item.EndsAt, item.Calendar, BlocksTime: item.BlocksTime)).ToList();
        foreach (var busy in google.Snapshot.Busy.Where(b => AgendaRules.Overlaps(start, end, b.StartsAt, b.EndsAt)))
        {
            var covered = busy.StartsAt;
            foreach (var item in events.Where(item => item.BlocksTime && AgendaRules.Overlaps(busy.StartsAt, busy.EndsAt, item.StartsAt, item.EndsAt)))
            {
                var from = item.StartsAt > busy.StartsAt ? item.StartsAt : busy.StartsAt;
                var to = item.EndsAt < busy.EndsAt ? item.EndsAt : busy.EndsAt;
                if (covered < from) AddBusy(covered, from);
                if (to > covered) covered = to;
            }
            if (covered < busy.EndsAt) AddBusy(covered, busy.EndsAt);
        }

        return blocks.Select(block => block with { Overlap = pact.Any(other => Intersects(block, other)) })
            .Concat(pact.Select(block => block with { Overlap = blocks.Any(other => Intersects(block, other)) }))
            .OrderBy(block => block.StartsAt).ThenBy(block => block.EndsAt).ToArray();

        void AddBusy(DateTimeOffset from, DateTimeOffset to)
        {
            if (AgendaRules.Overlaps(start, end, from, to)) blocks.Add(new("google:busy:" + from.UtcTicks, "Google", "Ocupado", from, to));
        }
    }

    private static bool Intersects(AgendaOccupationBlock a, AgendaOccupationBlock b) =>
        a.BlocksTime && b.BlocksTime && AgendaRules.Overlaps(a.StartsAt, a.EndsAt, b.StartsAt, b.EndsAt);
}
