namespace PaCT.Api.Consultations;

public sealed record ConsultationPushItem(string Id, string? PersonId, DateTimeOffset DueAt, bool Active, string? State, string Kind);
public static class ConsultationPush
{
    public static ConsultationPushItem[] Items(ConsultationData data, DateTimeOffset now)
    {
        var conversations = data.Notices.Where(n => !n.Cancelled && n.ReadAt is null && n.Kind.StartsWith("FollowupMessage:", StringComparison.Ordinal))
            .GroupBy(n => (n.ConsultationId, n.PersonId)).ToDictionary(g => g.Key, g => g.OrderBy(n => n.DueAt).ThenBy(n => n.Id).First().Id);
        return data.Notices.Where(n => n.PushState is not null)
        .Select(n => new ConsultationPushItem(n.Id, n.PersonId, n.DueAt,
            !n.Cancelled && n.ReadAt is null && (n.ExpiresAt is null || n.ExpiresAt > now)
                && (!n.Kind.StartsWith("FollowupMessage:", StringComparison.Ordinal) || conversations.GetValueOrDefault((n.ConsultationId, n.PersonId)) == n.Id)
                && (n.Kind is not ("Wait8" or "Wait12") || data.Consultations.Any(c => c.Id == n.ConsultationId && c.ExpectationOpen)), n.PushState, n.Kind))
        .Concat(data.EventNotices.Where(n => n.PushState is not null)
            .Select(n => new ConsultationPushItem(n.Id, n.PersonId, n.DueAt,
                !n.Cancelled && n.ReadAt is null && (n.ExpiresAt is null || n.ExpiresAt > now)
                    && (n.Kind is not ("EventWait8" or "EventWait12") || data.Participations.Any(p => p.Id == n.ParticipationId && p.State == "Confirmed" && p.ExpectationOpen)), n.PushState, n.Kind))).ToArray();
    }

    public static bool ChangeState(ConsultationData data, string id, string state, DateTimeOffset now)
    {
        if (state is not ("Sending" or "Submitted" or "Uncertain" or "Failed")) return false;
        var item = Items(data, now).SingleOrDefault(n => n.Id == id);
        if (item is null || (state == "Sending" ? !item.Active || item.State != "Pending" || item.DueAt > now : item.State != "Sending")) return false;
        var index = data.Notices.FindIndex(n => n.Id == id);
        if (index >= 0) data.Notices[index] = data.Notices[index] with { PushState = state };
        else { index = data.EventNotices.FindIndex(n => n.Id == id); data.EventNotices[index] = data.EventNotices[index] with { PushState = state }; }
        return true;
    }
}

public sealed class ConsultationPushWorker(IConsultationStore store, IBrowserPushStore subscriptions, IBrowserPushTransport transport,
    TimeProvider time, ILogger<ConsultationPushWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var recovered = false;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!recovered)
                {
                    var interrupted = await store.ReadAsync(data => ConsultationPush.Items(data, time.GetUtcNow()).Where(n => n.State == "Sending").ToArray(), stoppingToken);
                    foreach (var item in interrupted) await store.UpdateConsultationPushAsync(item.Id, "Uncertain", stoppingToken);
                    recovered = true;
                }
                await ProcessAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception error) { logger.LogWarning("Consultation push unavailable: {ErrorType}", error.GetType().Name); }
            try { await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }
    internal async Task ProcessAsync(CancellationToken ct)
    {
        var pending = await store.ReadAsync(data => ConsultationPush.Items(data, time.GetUtcNow()).Where(n => n.Active && n.State == "Pending" && n.DueAt <= time.GetUtcNow()).ToArray(), ct);
        foreach (var item in pending)
        {
            var browsers = await subscriptions.ForPerson(item.PersonId, ct);
            if (browsers.Count == 0 || !await store.UpdateConsultationPushAsync(item.Id, "Sending", ct)) continue;
            try
            {
                var submitted = false;
                foreach (var browser in browsers)
                    if (await transport.Send(browser.Subscription, item.Id, ct, item.Kind)) submitted = true;
                    else await subscriptions.Remove(browser.Id, null, ct);
                await store.UpdateConsultationPushAsync(item.Id, submitted ? "Submitted" : "Failed", ct);
            }
            catch { await store.UpdateConsultationPushAsync(item.Id, "Uncertain", CancellationToken.None); throw; }
        }
    }
}
