using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace PaCT.Api.Health;

public static class HealthResponse
{
    public static Task WriteAsync(HttpContext context, HealthReport report)
    {
        context.Response.Headers.CacheControl = "no-store";
        return context.Response.WriteAsJsonAsync(new
        {
            status = report.Status == HealthStatus.Healthy ? "available" : "unavailable",
            checks = report.Entries.ToDictionary(entry => entry.Key,
                entry => entry.Value.Status == HealthStatus.Healthy ? "available" : "unverified")
        }, cancellationToken: context.RequestAborted);
    }
}

