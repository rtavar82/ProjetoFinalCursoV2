using Microsoft.AspNetCore.Mvc;
using PaCT.Api.Configuration;

namespace PaCT.Api.Controllers;

[ApiController]
[Route("api/status")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class StatusController(DatabaseConnectionSettings database) : ControllerBase
{
    [HttpGet]
    public IActionResult Get() => Ok(new
    {
        application = "PaCT",
        version = "0.2",
        stage = "client-foundation",
        status = "available",
        database = database.IsConfigured ? "unverified" : "unconfigured",
        externalCommunications = "security-email-queue"
    });
}

