using MailKit.Security;
using MimeKit;
using System.Text.Json;

namespace PaCT.Api.Identity;

public interface ISecurityEmailTransport
{
    void CheckConfiguration();
    Task<string> SendAsync(EmailPayload payload, CancellationToken ct);
}

public sealed class SmtpSecurityEmailTransport(IConfiguration configuration, InstallationSecrets installation) : ISecurityEmailTransport
{
    public void CheckConfiguration()
    {
        _ = installation.PublicWebUrl;
        if (string.IsNullOrWhiteSpace(configuration["Email:Smtp:Host"])
            || string.IsNullOrWhiteSpace(configuration["Email:Smtp:UserName"])
            || string.IsNullOrWhiteSpace(configuration["Email:Smtp:Password"])
            || !MailboxAddress.TryParse(configuration["Email:Smtp:FromEmail"], out _)
            || !int.TryParse(configuration["Email:Smtp:Port"], out var port) || port is < 1 or > 65535)
            throw new IdentityProblem(503, "Falta concluir a configuração privada do envio de emails.");
    }

    public async Task<string> SendAsync(EmailPayload payload, CancellationToken ct)
    {
        CheckConfiguration();
        var content = SecurityEmailContent.Create(payload, installation.PublicWebUrl);
        var sending = false;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(25));
        try
        {
            using var smtp = new MailKit.Net.Smtp.SmtpClient { Timeout = 20000 };
            var port = int.Parse(configuration["Email:Smtp:Port"]!);
            await smtp.ConnectAsync(configuration["Email:Smtp:Host"]!, port, port == 465 ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTls, timeout.Token);
            await smtp.AuthenticateAsync(configuration["Email:Smtp:UserName"]!, configuration["Email:Smtp:Password"]!, timeout.Token);
            var message = new MimeMessage();
            message.From.Add(new MailboxAddress(configuration["Email:Smtp:FromName"] ?? "PaCT", configuration["Email:Smtp:FromEmail"]!));
            message.To.Add(MailboxAddress.Parse(payload.Recipient));
            message.Subject = content.Subject;
            message.Body = new TextPart("plain") { Text = content.Body };
            sending = true;
            await smtp.SendAsync(message, timeout.Token);
            return "Submitted";
        }
        catch (Exception) { return sending ? "Uncertain" : "Failed"; }
    }
}

internal static class SecurityEmailContent
{
    internal static (string Subject, string Body) Create(EmailPayload payload, string publicWebUrl) => payload.Kind switch
    {
        "ConfirmEmail" => ("PaCT — confirma o teu email", "Confirma o email da tua conta de gestão PaCT.\n\n"
            + publicWebUrl + "/#confirm-email=" + Uri.EscapeDataString(payload.Token)
            + "\n\nO link é pessoal e válido durante 24 horas. Abri-lo não confirma a ação. Se não fizeste este pedido, ignora esta mensagem."),
        "ClientConfirmEmail" => ("PaCT — confirma o teu email", "Confirma o teu email para criar a tua conta de cliente PaCT. Depois da confirmação, poderás definir a tua palavra-passe.\n\n"
            + publicWebUrl + "/#confirm-email=" + Uri.EscapeDataString(payload.Token)
            + "\n\nO link é pessoal, válido durante 24 horas e de uso único. Abrir o link não confirma o email nem inicia sessão. Se não fizeste este pedido, ignora esta mensagem."),
        "TherapistInvitation" => ("PaCT — convite para gestora-terapeuta", "O gestor técnico convidou-te para seres a gestora-terapeuta desta instalação PaCT.\n\n"
            + publicWebUrl + "/#therapist-invitation=" + Uri.EscapeDataString(payload.Token)
            + "\n\nO convite é pessoal, válido durante 24 horas e só pode ser utilizado uma vez. Abrir o link não cria uma conta."
            + "\n\nDefine os teus dados e a tua própria palavra-passe. Depois, confirma o email e ativa o Google Authenticator para aceder à gestão."
            + "\n\nSe não esperavas este convite, ignora esta mensagem. Nunca partilhes a tua palavra-passe ou códigos de segurança."),
        "ClientAccessEmail" => ("PaCT — confirma o teu novo email", "Confirma este endereço para passares a usá-lo na tua conta PaCT. A tua palavra-passe mantém-se.\n\n"
            + publicWebUrl + "/#confirm-access-email=" + Uri.EscapeDataString(payload.Token)
            + "\n\nO link é pessoal e válido durante 24 horas. Carrega no botão da página para confirmar. Se não pediste esta alteração, contacta a gestão."),
        "PasswordChange" => ("PaCT — altera a tua palavra-passe", "Recebemos o teu pedido para alterar a palavra-passe. Escolhe a nova palavra-passe nesta página:\n\n"
            + publicWebUrl + "/#change-password=" + Uri.EscapeDataString(payload.Token)
            + "\n\nO link é pessoal, de uso único e válido durante 24 horas. Abrir o link não altera a palavra-passe. Se não fizeste este pedido, ignora esta mensagem."),
        "PackReminder" => ("PaCT — lembrete do teu pack", "Faltam dois meses para a referência de um ano do teu pack. Consulta as sessões disponíveis na tua área PaCT e combina a sua utilização com a terapeuta.\n\n"
            + publicWebUrl + "/#inicio\n\nAs sessões não são retiradas nem bloqueadas automaticamente por esta data."),
        _ => throw new InvalidOperationException("Unknown security email kind.")
    };
}

public sealed class SecurityEmailWorker(IIdentityStore store, ITherapistInvitationStore invitations, IdentitySecurity security, IInstallationSecrets installation,
    ISecurityEmailTransport transport, TimeProvider time, ILogger<SecurityEmailWorker> logger, ClientAccessService? clientAccess = null, PasswordChangeService? passwords = null,
    PaCT.Api.Consultations.IConsultationStore? consultations = null) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (installation.IsPrepared)
                    await ProcessNextAsync(stoppingToken);
                await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception error)
            {
                logger.LogWarning("Security email processing unavailable: type={ErrorType}", error.GetType().Name);
                try { await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            }
        }
    }

    internal async Task<bool> ProcessNextAsync(CancellationToken ct)
    {
        transport.CheckConfiguration();
        var now = time.GetUtcNow().UtcDateTime;
        await store.RecoverInterruptedEmailsAsync(now, ct);
        var job = await store.ClaimEmailAsync(now, ct);
        if (job is null) return false;
        var account = await store.FindAsync(job.AccountId, ct);
        var payload = JsonSerializer.Deserialize<EmailPayload>(security.Decrypt(job.Id, "email-job", job.Payload))
            ?? throw new JsonException("Invalid security email payload.");
        var eligible = false;
        if (account is { ClosedAt: null, PersonActive: true, LinkStatus: "Verified" } && job.CreatedAt.AddHours(24) > now)
        {
            if (payload.Kind == "ConfirmEmail" && payload.InvitationId is null) eligible = account.EmailConfirmedAt is null;
            else if (payload.Kind == "ClientConfirmEmail" && payload.InvitationId is null && account.Role == Roles.Client && account.PasswordHash is null)
                eligible = security.TryReadAction("confirm-email", payload.Token, out var action, out _) && action.Stamp == account.SecurityStamp;
            else if (payload.Kind == "TherapistInvitation" && payload.InvitationId is not null
                && account is { Role: Roles.TechnicalManager, EmailConfirmedAt: not null }
                && (account.PasskeyEnabledAt is not null || account.TwoFactorEnabledAt is not null))
            {
                var invitation = await invitations.FindInvitationAsync(payload.InvitationId, ct);
                eligible = invitation is not null && invitation.IsOpen(now) && invitation.CreatedByAccountId == account.Id
                    && invitation.EmailJobId == job.Id && await invitations.FindTherapistAsync(ct) is null;
            }
        }
        if (payload.Kind == "ClientAccessEmail" && clientAccess is not null)
            eligible = await clientAccess.CanSendEmailAsync(job, payload, ct);
        if (payload.Kind == "PasswordChange" && passwords is not null)
            eligible = await passwords.CanSendAsync(job, payload, ct);
        if (payload.Kind == "PackReminder" && consultations is not null && account is { Role: Roles.Client, ClosedAt: null, PersonActive: true, LinkStatus: "Verified", EmailConfirmedAt: not null }
            && payload.Recipient == security.Decrypt(account.PersonId, "email", account.EmailCiphertext))
            eligible = await consultations.ReadAsync(data => data.PackNotices.Any(n => n.Id == payload.Token && n.PersonId == account.PersonId
                && !n.Cancelled && n.Kind.StartsWith("PackExpiry:") && n.DueAt <= time.GetUtcNow() && n.ExpiresAt > time.GetUtcNow()
                && PaCT.Api.Consultations.SessionPacks.Remaining(data, n.PackId) > 0), ct);
        var state = eligible ? await transport.SendAsync(payload, ct) : "Cancelled";
        await store.CompleteEmailAsync(job.Id, state, time.GetUtcNow().UtcDateTime, ct);
        return true;
    }
}
