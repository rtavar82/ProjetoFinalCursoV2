using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using WebPush;

namespace PaCT.Api.Consultations;

public sealed record BrowserPush(string Endpoint, Dictionary<string, string> Keys);
public sealed record PushKeys(string PublicKey, string PrivateKey);

public sealed class BalancePushKeys(InstallationPaths paths, IDataProtectionProvider provider, IConfiguration configuration)
{
    private string PathName => Path.Combine(paths.Root, "web-push.protected");
    private IDataProtector Protector => provider.CreateProtector("PaCT0.2.WebPush.v1");
    public PushKeys Read() => JsonSerializer.Deserialize<PushKeys>(Protector.Unprotect(File.ReadAllBytes(PathName)))!;
    public void Prepare()
    {
        if (File.Exists(PathName)) { _ = Read(); return; }
        var pair = VapidHelper.GenerateVapidKeys(); Directory.CreateDirectory(paths.Root);
        using var file = new FileStream(PathName, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        file.Write(Protector.Protect(JsonSerializer.SerializeToUtf8Bytes(new PushKeys(pair.PublicKey, pair.PrivateKey))));
    }
    public string ProtectBrowser(string account, string endpointId) => provider.CreateProtector("PaCT0.2.PushBrowser.v1").Protect(account + "|" + endpointId);
    public string? ReadBrowser(string account, string? value)
    {
        if (value is null) return null;
        try { var text = provider.CreateProtector("PaCT0.2.PushBrowser.v1").Unprotect(value); return text.StartsWith(account + "|", StringComparison.Ordinal) ? text[(account.Length + 1)..] : null; }
        catch (CryptographicException) { return null; }
    }
    public VapidDetails Details()
    {
        var keys = Read();
        var subject = configuration["Application:WebUrl"];
        if (!Uri.TryCreate(subject, UriKind.Absolute, out var uri) || uri.Scheme != "https" || !string.IsNullOrEmpty(uri.UserInfo))
            throw new IdentityProblem(503, "Configura o endereço HTTPS público da instalação para as notificações.");
        return new(uri.GetLeftPart(UriPartial.Authority), keys.PublicKey, keys.PrivateKey);
    }
}

public interface IBrowserPushStore
{
    Task Save(string account, BrowserPush value, CancellationToken ct);
    Task Remove(string id, string? account, CancellationToken ct);
    Task RemoveEndpoint(string account, string endpoint, CancellationToken ct);
    Task<List<(string Id, BrowserPush Subscription)>> ForPerson(string? person, CancellationToken ct);
}
public sealed class BrowserPushStore(DatabaseConnectionSettings settings, IdentitySecurity security) : IBrowserPushStore
{
    internal static bool Valid(BrowserPush value)
    {
        if (value.Keys is null || string.IsNullOrWhiteSpace(value.Endpoint) || value.Endpoint.Length > 4096 || !Uri.TryCreate(value.Endpoint, UriKind.Absolute, out var uri) || uri.Scheme != "https"
            || !uri.IsDefaultPort || uri.UserInfo.Length != 0 || uri.Fragment.Length != 0) return false;
        // Never permit a client-supplied push endpoint to become an arbitrary server-side request.
        var host = uri.IdnHost;
        if (!(host == "fcm.googleapis.com" || host == "updates.push.services.mozilla.com" || host == "web.push.apple.com"
            || host.EndsWith(".notify.windows.com", StringComparison.Ordinal))) return false;
        if (!value.Keys.TryGetValue("p256dh", out var publicKey) || !value.Keys.TryGetValue("auth", out var auth)) return false;
        try { return Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlDecode(publicKey).Length == 65
            && Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlDecode(auth).Length == 16; }
        catch (FormatException) { return false; }
    }
    internal static string Key(string endpoint) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(endpoint)));
    public async Task Save(string account, BrowserPush value, CancellationToken ct)
    {
        if (!Valid(value)) throw new IdentityProblem(400, "A inscrição de notificações deste navegador é inválida.");
        var id = Key(value.Endpoint);
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
        await using var command = new MySqlCommand("INSERT INTO push_subscriptions(id,account_id,payload,updated_at) VALUES(@id,@account,@payload,UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE account_id=@account,payload=@payload,updated_at=UTC_TIMESTAMP(6)", connection);
        command.Parameters.AddWithValue("@id", id); command.Parameters.AddWithValue("@account", account);
        command.Parameters.AddWithValue("@payload", security.Encrypt(id, "browser-push", JsonSerializer.Serialize(value)));
        await command.ExecuteNonQueryAsync(ct);
    }
    public async Task Remove(string id, string? account, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
        await using var command = new MySqlCommand("DELETE FROM push_subscriptions WHERE id=@id AND (@account IS NULL OR account_id=@account)", connection);
        command.Parameters.AddWithValue("@id", id); command.Parameters.AddWithValue("@account", (object?)account ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(ct);
    }
    public Task RemoveEndpoint(string account, string endpoint, CancellationToken ct) => Remove(Key(endpoint), account, ct);
    public async Task<List<(string Id, BrowserPush Subscription)>> ForPerson(string? person, CancellationToken ct)
    {
        var result = new List<(string, BrowserPush)>();
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
        await using var command = new MySqlCommand("SELECT s.id,s.payload FROM push_subscriptions s JOIN accounts a ON a.id=s.account_id JOIN people p ON p.id=a.origin_person_id WHERE ((@person IS NOT NULL AND a.origin_person_id=@person AND a.role='Client') OR (@person IS NULL AND a.role IN ('TechnicalManager','TherapistManager'))) AND a.closed_at IS NULL AND p.is_active=1 AND a.link_status='Verified' AND a.email_confirmed_at IS NOT NULL ORDER BY s.id LIMIT 20", connection);
        command.Parameters.AddWithValue("@person", (object?)person ?? DBNull.Value);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var id = reader.GetString(0);
            var value = JsonSerializer.Deserialize<BrowserPush>(security.Decrypt(id, "browser-push", (byte[])reader[1]))!;
            if (Valid(value)) result.Add((id, value));
        }
        return result;
    }
}

[ApiController, Route("api/push"), Authorize(Roles = Roles.ManagersAndClient), ResponseCache(NoStore = true)]
public sealed class BrowserPushController(IBrowserPushStore store, BalancePushKeys keys) : ControllerBase
{
    [HttpGet("key")]
    public object Key() => new { publicKey = keys.Read().PublicKey };
    [HttpPost("subscribe"), EnableRateLimiting("write"), RequestSizeLimit(8192)]
    public async Task<IActionResult> Subscribe(BrowserPush value, CancellationToken ct)
    {
        var account = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await store.Save(account, value, ct);
        Response.Cookies.Append("__Host-PaCT.Push", keys.ProtectBrowser(account, BrowserPushStore.Key(value.Endpoint)),
            new CookieOptions { Secure = true, HttpOnly = true, SameSite = SameSiteMode.Strict, Path = "/", MaxAge = TimeSpan.FromDays(30) });
        return Ok(new { enabled = true });
    }
    [HttpPost("unsubscribe"), EnableRateLimiting("write"), RequestSizeLimit(8192)]
    public async Task<IActionResult> Unsubscribe(BrowserPush value, CancellationToken ct)
    {
        await store.RemoveEndpoint(User.FindFirstValue(ClaimTypes.NameIdentifier)!, value.Endpoint, ct); return Ok(new { enabled = false });
    }
}

public interface IBrowserPushTransport
{
    Task<bool> Send(BrowserPush subscription, string noticeId, CancellationToken ct, string kind = "Balance");
}
public sealed class BrowserPushTransport(BalancePushKeys keys) : IBrowserPushTransport
{
    public async Task<bool> Send(BrowserPush subscription, string noticeId, CancellationToken ct, string kind = "Balance")
    {
        using var handler = new HttpClientHandler { AllowAutoRedirect = false };
        using var http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(20) };
        using var client = new WebPushClient(http);
        // Lock-screen payload contains no name, amount or private reason. Details require authentication.
        var balance = kind == "Balance";
        var waiting = kind is "Wait8" or "Wait12" or "EventWait8" or "EventWait12";
        var payload = JsonSerializer.Serialize(new { title = "PaCT", body = balance ? "Existe uma atualização no teu saldo. Consulta os pagamentos na aplicação."
            : waiting ? "Existe um pagamento por confirmar. Consulta os detalhes na PaCT." : "Tens uma atualização na PaCT. Abre a aplicação para consultar.",
            tag = (balance ? "balance-" : "consultation-") + noticeId, url = balance ? "/?view=payments" : "/#agenda" });
        try { await client.SendNotificationAsync(new PushSubscription(subscription.Endpoint, subscription.Keys["p256dh"], subscription.Keys["auth"]), payload, keys.Details(), cancellationToken: ct); return true; }
        catch (WebPushException error) when (error.StatusCode is HttpStatusCode.Gone or HttpStatusCode.NotFound) { return false; }
    }
}
public sealed class BalancePushWorker(IConsultationStore consultations, IBrowserPushStore subscriptions, IBrowserPushTransport transport,
    ILogger<BalancePushWorker> logger) : BackgroundService
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
                    var interrupted = await consultations.ReadAsync(data => data.BalanceNotices.Where(n => n.PushState == "Sending").Select(n => n.Id).ToArray(), stoppingToken);
                    foreach (var id in interrupted) await consultations.UpdateBalancePushAsync(id, "Uncertain", stoppingToken);
                    recovered = true;
                }
                var pending = await consultations.ReadAsync(data => data.BalanceNotices.Where(n => n.ClosedAt is null && n.PushState == "Pending").ToArray(), stoppingToken);
                foreach (var notice in pending)
                {
                    var browsers = await subscriptions.ForPerson(notice.PersonId, stoppingToken);
                    if (browsers.Count == 0) continue; // Retain delivery until a permitted device exists.
                    if (!await consultations.UpdateBalancePushAsync(notice.Id, "Sending", stoppingToken)) continue;
                    try
                    {
                        var submitted = false;
                        foreach (var browser in browsers)
                            if (await transport.Send(browser.Subscription, notice.Id, stoppingToken)) submitted = true;
                            else await subscriptions.Remove(browser.Id, null, stoppingToken);
                        await consultations.UpdateBalancePushAsync(notice.Id, submitted ? "Submitted" : "Failed", stoppingToken);
                    }
                    catch
                    {
                        await consultations.UpdateBalancePushAsync(notice.Id, "Uncertain", CancellationToken.None);
                        throw;
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception error) { logger.LogWarning("Balance push unavailable: {ErrorType}", error.GetType().Name); }
            try { await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }
}
