using System.Security.Claims;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging;

namespace PaCT.Api.Identity;

public sealed record SecurityAuditEvent(
    string Id,
    DateTime OccurredAt,
    string EventType,
    string Outcome,
    string Severity,
    string? ActorAccountId = null,
    string? ActorRole = null,
    string? RequestId = null,
    string? HttpMethod = null,
    string? Route = null,
    int? StatusCode = null,
    string? Detail = null,
    string? ResourceId = null)
{
    public static SecurityAuditEvent Create(DateTime occurredAt, string eventType, string outcome, string severity,
        string? actorAccountId = null, string? actorRole = null, string? requestId = null, string? httpMethod = null,
        string? route = null, int? statusCode = null, string? detail = null, string? resourceId = null) =>
        new(Guid.NewGuid().ToString("D"), occurredAt, eventType, outcome, severity, actorAccountId, actorRole,
            requestId, httpMethod, route, statusCode, detail, resourceId);
}

public sealed record SecurityAuditQuery(int Page, int PageSize, string? EventType, string? Outcome);

public sealed record SecurityAuditSummary(int Total, int Last24Hours, int Attention, int SensitiveReads);

public sealed record SecurityAuditPage(SecurityAuditSummary Summary, IReadOnlyList<SecurityAuditEvent> Items, int Total, int Page, int PageSize);

public interface ISecurityAuditStore
{
    Task RecordAsync(SecurityAuditEvent entry, CancellationToken ct);
    // A null page means audit storage has not been prepared.
    Task<SecurityAuditPage?> ReadAsync(SecurityAuditQuery query, DateTime now, CancellationToken ct);
}

public sealed class SecurityAuditWriter(ISecurityAuditStore store, ILogger<SecurityAuditWriter> logger)
{
    public async Task TryRecordAsync(SecurityAuditEvent entry, CancellationToken ct)
    {
        try
        {
            await store.RecordAsync(entry, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception error)
        {
            // Audit failure must not turn a valid login or business operation into a false failure.
            logger.LogWarning("Security audit unavailable: type={ErrorType}", error.GetType().Name);
        }
    }
}

public static class SecurityAuditEventFactory
{
    public static SecurityAuditEvent? ForResponse(HttpContext context, DateTime now)
    {
        var status = context.Response.StatusCode;
        var route = Route(context);
        var signIn = string.Equals(route, "api/identity/sign-in", StringComparison.OrdinalIgnoreCase);
        var factor = string.Equals(route, "api/identity/verify-factor", StringComparison.OrdinalIgnoreCase)
            || string.Equals(route, "api/identity/passkeys/assertion/finish", StringComparison.OrdinalIgnoreCase);

        return status switch
        {
            StatusCodes.Status401Unauthorized when signIn => Http(context, now, "LoginFailed", "Failure", "Warning", "credentials_rejected"),
            StatusCodes.Status400BadRequest when factor => Http(context, now, "LoginFailed", "Failure", "Warning", "factor_rejected"),
            StatusCodes.Status401Unauthorized => Http(context, now, "AuthenticationRequired", "Denied", "Warning", "authentication_required"),
            StatusCodes.Status403Forbidden => Http(context, now, "AccessDenied", "Denied", "Warning", "authorization_denied"),
            StatusCodes.Status429TooManyRequests => Http(context, now, "RateLimitExceeded", "Blocked", "Warning", "rate_limit_exceeded"),
            _ when status is >= 200 and < 300 && HttpMethods.IsGet(context.Request.Method) && IsSensitiveRead(route)
                && context.User.Identity?.IsAuthenticated == true => Http(context, now, "SensitiveDataRead", "Success", "Info", "authorized_read"),
            _ => null
        };
    }

    public static SecurityAuditEvent InternalError(HttpContext context, DateTime now) =>
        Http(context, now, "InternalError", "Error", "Critical", "unhandled_exception", StatusCodes.Status500InternalServerError);

    public static SecurityAuditEvent SessionEstablished(HttpContext context, IdentityAccount account, DateTime now, string method) =>
        SecurityAuditEvent.Create(now, "LoginSucceeded", "Success", "Info", account.Id, account.Role, context.TraceIdentifier,
            context.Request.Method, Route(context), context.Response.StatusCode, method.ToLowerInvariant());

    public static SecurityAuditEvent Background(DateTime now, string eventType, string outcome, string severity,
        string? accountId, string? role, string detail, string? resourceId = null) =>
        SecurityAuditEvent.Create(now, eventType, outcome, severity, accountId, role, null, null,
            "worker/security-email", null, detail, resourceId);

    private static SecurityAuditEvent Http(HttpContext context, DateTime now, string eventType, string outcome, string severity,
        string detail, int? statusCode = null)
    {
        var actorId = context.User.Identity?.IsAuthenticated == true
            ? context.User.FindFirstValue(ClaimTypes.NameIdentifier) : null;
        var role = context.User.FindFirstValue(ClaimTypes.Role);
        var route = Route(context);
        var resourceId = context.Request.RouteValues.TryGetValue("id", out var value) && value is not null
            && value.ToString()!.Length <= 128 ? value.ToString() : null;
        return SecurityAuditEvent.Create(now, eventType, outcome, severity, actorId, role, context.TraceIdentifier,
            context.Request.Method, route, statusCode ?? context.Response.StatusCode, detail, resourceId);
    }

    public static string Route(HttpContext context)
    {
        var route = (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText;
        return (route ?? context.Request.Path.Value ?? "/").TrimStart('/');
    }

    private static bool IsSensitiveRead(string route) =>
        route.StartsWith("api/clients/{id", StringComparison.OrdinalIgnoreCase)
        || route.StartsWith("api/consultations/{id", StringComparison.OrdinalIgnoreCase)
        || route.StartsWith("api/finance/expenses/{id", StringComparison.OrdinalIgnoreCase);
}

public sealed class SecurityAuditMiddleware(RequestDelegate next, SecurityAuditWriter audit, TimeProvider time)
{
    public async Task InvokeAsync(HttpContext context)
    {
        await next(context);
        if (SecurityAuditEventFactory.ForResponse(context, time.GetUtcNow().UtcDateTime) is { } entry)
            await audit.TryRecordAsync(entry, context.RequestAborted);
    }
}
