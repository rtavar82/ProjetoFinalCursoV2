using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PaCT.Api.Identity;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/identity/security-audit"), Authorize(Roles = Roles.Managers)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class SecurityAuditController(ISecurityAuditStore store, TimeProvider time) : ControllerBase
{
    private static readonly string[] EventTypes = ["LoginSucceeded", "LoginFailed", "AuthenticationRequired", "AccessDenied", "RateLimitExceeded", "SensitiveDataRead", "EmailFailed", "EmailUncertain", "EmailWorkerError", "EmailReviewRecorded", "InternalError"];
    private static readonly string[] Outcomes = ["Success", "Failure", "Denied", "Blocked", "Uncertain", "Error"];

    [HttpGet]
    public async Task<IActionResult> Read(int page = 1, string? eventType = null, string? outcome = null, CancellationToken ct = default)
    {
        if (page is < 1 or > 100000) throw new IdentityProblem(400, "A página da auditoria não é válida.");
        if (eventType is not null && !EventTypes.Contains(eventType, StringComparer.Ordinal)) throw new IdentityProblem(400, "O tipo de evento da auditoria não é válido.");
        if (outcome is not null && !Outcomes.Contains(outcome, StringComparer.Ordinal)) throw new IdentityProblem(400, "O resultado da auditoria não é válido.");
        var result = await store.ReadAsync(new(page, 12, eventType, outcome), time.GetUtcNow().UtcDateTime, ct);
        if (result is null) return Ok(new { state = "NotPrepared" });
        return Ok(new
        {
            summary = new { total = result.Summary.Total, last24Hours = result.Summary.Last24Hours, attention = result.Summary.Attention, sensitiveReads = result.Summary.SensitiveReads },
            items = result.Items.Select(item => new
            {
                item.Id, occurredAt = item.OccurredAt, type = item.EventType, outcome = item.Outcome, severity = item.Severity,
                actorAccountId = item.ActorAccountId, actorRole = item.ActorRole, requestId = item.RequestId,
                method = item.HttpMethod, route = item.Route, statusCode = item.StatusCode, detail = item.Detail, resourceId = item.ResourceId
            }),
            total = result.Total, page = result.Page, pageSize = result.PageSize,
            filters = new { eventTypes = EventTypes, outcomes = Outcomes }
        });
    }
}
