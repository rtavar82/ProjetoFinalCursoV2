using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MySql.Data.MySqlClient;
using PaCT.Api.Identity;
using PaCT.Api.Management;

namespace PaCT.Api.Controllers;

[ApiController, Route("api/management/tasks"), Authorize(Roles = Roles.Managers), ResponseCache(NoStore = true)]
public sealed class ManagerTasksController(ManagerTaskStore tasks) : ControllerBase
{
    private string Account => User.FindFirstValue(ClaimTypes.NameIdentifier)!;

    [HttpGet]
    public async Task<IActionResult> List(bool completed = false, int page = 1, CancellationToken ct = default)
    {
        try { return Ok(await tasks.ListAsync(completed, page, ct)); }
        catch (MySqlException error) when (error.Number == 1146)
        { throw new IdentityProblem(503, "A área de Tarefas ainda precisa de ser preparada nesta instalação."); }
    }

    [HttpPost, EnableRateLimiting("write"), RequestSizeLimit(65536)]
    public async Task<IActionResult> Create(NewManagerTask input, CancellationToken ct)
    {
        await tasks.CreateAsync(input, Account, ct);
        return Ok(new { id = input.OperationId });
    }

    [HttpPost("{id:guid}/complete"), EnableRateLimiting("write")]
    public async Task<IActionResult> Complete(Guid id, CancellationToken ct)
    {
        await tasks.CompleteAsync(id, Account, ct);
        return Ok(new { id });
    }

    [HttpGet("reminders")]
    public async Task<IActionResult> Reminders(CancellationToken ct) => Ok(await tasks.RemindersAsync(ct));

    [HttpPost("{id:guid}/read-reminder"), EnableRateLimiting("write")]
    public async Task<IActionResult> ReadReminder(Guid id, CancellationToken ct)
    {
        await tasks.ReadReminderAsync(id, ct);
        return Ok(new { id });
    }
}
