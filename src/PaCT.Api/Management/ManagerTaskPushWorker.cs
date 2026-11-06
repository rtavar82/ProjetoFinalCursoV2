using PaCT.Api.Consultations;

namespace PaCT.Api.Management;

public sealed class ManagerTaskPushWorker(ManagerTaskStore tasks, IBrowserPushStore subscriptions,
    IBrowserPushTransport transport, ILogger<ManagerTaskPushWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        do
        {
            try { await SendDueAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception error) { logger.LogWarning("Task reminders unavailable: {ErrorType}", error.GetType().Name); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task SendDueAsync(CancellationToken ct)
    {
        var due = await tasks.PendingPushAsync(ct);
        if (due.Count == 0) return;
        var browsers = await subscriptions.ForPerson(null, ct);
        if (browsers.Count == 0) return;

        foreach (var id in due)
        {
            if (!await tasks.ChangePushAsync(id, "Sending", ct)) continue;
            var submitted = false;
            var uncertain = false;
            foreach (var browser in browsers)
            {
                try
                {
                    if (await transport.Send(browser.Subscription, id, ct, "ManagerTask")) submitted = true;
                    else await subscriptions.Remove(browser.Id, null, ct);
                }
                catch (Exception error) when (!ct.IsCancellationRequested)
                {
                    uncertain = true;
                    logger.LogWarning("Task reminder delivery unconfirmed: {ErrorType}", error.GetType().Name);
                }
            }
            await tasks.ChangePushAsync(id, uncertain ? "Uncertain" : submitted ? "Submitted" : "Failed", ct);
        }
    }
}
