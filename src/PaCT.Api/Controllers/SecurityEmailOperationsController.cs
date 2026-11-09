using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using PaCT.Api.Clients;
using PaCT.Api.Identity;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/identity/email-operations"), Authorize(Roles = Roles.Managers)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class SecurityEmailOperationsController(ISecurityEmailOperationsStore store, ISecurityEmailTransport transport,
    SecurityEmailHealth health, TimeProvider time, SecurityAuditWriter? audit = null) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        SecurityEmailTransportStatus transportStatus;
        try { transportStatus = transport.GetConfigurationStatus(); }
        catch
        {
            transportStatus = new(false, "Configuration", "O envio de emails está indisponível: não foi possível verificar a configuração privada.");
            health.RecordFailure("Configuration", now);
        }
        health.ObserveConfiguration(transportStatus, now);
        var queue = await store.ReadEmailQueueAsync(ct);
        var snapshot = health.Snapshot();
        var workerState = snapshot.LastFailureCategory is not null ? "Unavailable"
            : snapshot.LastWorkerActivityAt is null ? "Unknown"
            : now - snapshot.LastWorkerActivityAt > TimeSpan.FromMinutes(2) ? "Stale" : "Active";
        return Ok(new
        {
            transport = new
            {
                status = transportStatus.Available ? "Available" : "Unavailable",
                category = transportStatus.Category,
                message = transportStatus.Message,
                lastCheckedAt = snapshot.LastConfigurationCheckAt
            },
            worker = new
            {
                status = workerState,
                lastActivityAt = snapshot.LastWorkerActivityAt,
                failureCategory = snapshot.LastFailureCategory,
                lastFailureAt = snapshot.LastFailureAt,
                lastOutcomeState = snapshot.LastOutcomeState,
                lastOutcomeAt = snapshot.LastOutcomeAt
            },
            queue = new
            {
                pending = queue.Pending,
                sending = queue.Sending,
                submitted = queue.Submitted,
                failed = queue.Failed,
                uncertain = queue.Uncertain,
                cancelled = queue.Cancelled,
                uncertainItems = queue.UncertainItems.Select(item => new { item.Id, item.State, item.CreatedAt, item.AttemptedAt, item.UpdatedAt, item.ReviewCount })
            },
            policy = new
            {
                automaticUncertainRetry = false,
                manualResendAuthorized = false,
                reviewActionAvailable = true,
                submittedConfirmsDelivery = false
            }
        });
    }

    [HttpPost("{id:guid}/review"), EnableRateLimiting("account")]
    public async Task<IActionResult> Review(string id, CancellationToken ct)
    {
        var operationId = ClientCommands.Key(Request) ?? throw new IdentityProblem(400, "A identificação desta revisão é obrigatória.");
        var manager = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var receipt = await store.RecordReviewAsync(id, operationId, manager, time.GetUtcNow().UtcDateTime, ct);
        if (audit is not null)
            await audit.TryRecordAsync(SecurityAuditEventFactory.Background(time.GetUtcNow().UtcDateTime, "EmailReviewRecorded", "Success", "Info", manager,
                User.FindFirstValue(ClaimTypes.Role), receipt.AlreadyRecorded ? "duplicate" : "review", receipt.EmailId), ct);
        return Ok(new
        {
            emailId = receipt.EmailId,
            operationId = receipt.OperationId,
            state = "Uncertain",
            reviewed = true,
            alreadyRecorded = receipt.AlreadyRecorded,
            resend = false,
            message = "Revisão registada. Nenhum email foi reenviado; confirma o resultado no servidor SMTP antes de qualquer nova decisão."
        });
    }
}
