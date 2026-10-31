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
            message.Body = payload.Appointment is not null
                ? AppointmentEmailLayout.Create(content.Subject, content.Body, installation.PublicWebUrl)
                : new TextPart("plain") { Text = content.Body };
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
        "GroupAcceptanceSummary" or "GroupConfirmation" => GroupSummary(payload, publicWebUrl),
        "PrepaymentApproval" or "BookingConfirmation" or "AppointmentReminder" or "AppointmentSharedInformation" => AppointmentContent(payload, publicWebUrl),
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
    private static (string Subject, string Body) GroupSummary(EmailPayload payload, string publicWebUrl)
    {
        var summary = payload.Appointment ?? throw new InvalidOperationException("Missing group acceptance summary.");
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Europe/Lisbon");
        var date = TimeZoneInfo.ConvertTime(summary.StartsAt, zone).ToString("dd/MM/yyyy HH:mm");
        var end = TimeZoneInfo.ConvertTime(summary.EndsAt, zone).ToString("HH:mm");
        if (summary.PaymentMode != "Prepayment")
            return ("PaCT — inscrição confirmada", "A tua inscrição na consulta de grupo ficou confirmada.\n\n"
                + summary.Service + "\n" + date + " — " + end + " (hora de Lisboa)\n\n" + summary.Instructions
                + "\n\nConsulta a tua inscrição na PaCT:\n" + publicWebUrl + "/#agenda");
        var amount = summary.Price is { } price ? price.ToString("0.00", System.Globalization.CultureInfo.GetCultureInfo("pt-PT")) + " €" : summary.PaymentMode == "Contribution" ? "Contribuição livre" : "Valor a combinar";
        var next = summary.PaymentMode == "Prepayment"
            ? "Aceitaste as condições e indicaste que vais efetuar o pagamento de seguida. Tens oito horas para o fazer. O recebimento será confirmado pela terapeuta."
            : summary.PaymentMode == "Contribution" ? "Aceitaste as condições. Escolhes a tua contribuição e pagas depois da consulta."
            : "Aceitaste as condições. O pagamento é feito depois da consulta.";
        return ("PaCT — resumo da inscrição e das condições aceites", "A tua inscrição na consulta de grupo ficou confirmada.\n\n"
            + summary.Service + "\n" + date + " — " + end + " (hora de Lisboa)\n" + summary.Instructions + "\nValor: " + amount
            + "\n\n" + next + "\nPodes pagar por transferência bancária, MB WAY ou dinheiro combinado com a terapeuta."
            + "\nOs meios e as condições que aceitaste estão disponíveis na tua inscrição na PaCT."
            + "\n\n" + publicWebUrl + "/#agenda");
    }
    private static (string Subject, string Body) AppointmentContent(EmailPayload payload, string publicWebUrl)
    {
        var summary = payload.Appointment ?? throw new InvalidOperationException("Missing appointment summary.");
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Europe/Lisbon");
        var date = TimeZoneInfo.ConvertTime(summary.StartsAt, zone).ToString("dd/MM/yyyy HH:mm");
        var subject = payload.Kind switch { "PrepaymentApproval" => "PaCT — condições da tua marcação", "BookingConfirmation" => "PaCT — marcação confirmada",
            "AppointmentReminder" => "PaCT — lembra-te da tua consulta", _ => "PaCT — informação disponível sobre a tua consulta" };
        var text = payload.Kind switch { "PrepaymentApproval" => "A gestão validou a tua marcação.\nAbre a PaCT para ler e aceitar as condições e consultar os meios de pagamento.",
            "BookingConfirmation" => "A tua marcação foi confirmada.", "AppointmentReminder" => "Brevemente faltarão 24 horas para a tua consulta.",
            _ => "Tens informação partilhada disponível na tua área PaCT." };
        var body = text + "\n\n" + summary.Service + "\n" + date + " (hora de Lisboa)";
        if (payload.Kind == "PrepaymentApproval")
        {
            if (summary.Price is { } price) body += "\nValor de referência: " + price.ToString("0.00", System.Globalization.CultureInfo.GetCultureInfo("pt-PT")) + " €";
            body += "\n\nCondições de pagamento\n" + string.Join("\n", PaCT.Api.Consultations.PublicPresentationContent.PrepaymentConditions.Select(line => "- " + line))
                + "\n\nCancelamentos ou faltas\n" + string.Join("\n", PaCT.Api.Consultations.PublicPresentationContent.PrepaymentCancellations.Select(line => "- " + line));
            var methods = JsonSerializer.SerializeToElement(PaCT.Api.Consultations.PublicPresentationContent.PaymentInformation);
            body += "\n\nForma de pagamento\nTransferência bancária\nIBAN: " + methods.GetProperty("iban").GetString()
                + "\nBIC/SWIFT: " + methods.GetProperty("bic").GetString()
                + "\nMB WAY: " + methods.GetProperty("mbWay").GetString()
                + "\nDinheiro: combinado com a terapeuta antes da consulta.\n" + methods.GetProperty("transferNote").GetString();
        }
        else body += "\n\n" + summary.Instructions;
        return (subject, body + "\n\n" + publicWebUrl + "/#agenda");
    }
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
        if (payload.Kind is "GroupAcceptanceSummary" or "GroupConfirmation" && consultations is not null && job.CreatedAt.AddHours(24) > now && job.Id == payload.Token
            && account is { Role: Roles.Client, ClosedAt: null, PersonActive: true, LinkStatus: "Verified", EmailConfirmedAt: not null }
            && payload.Recipient == security.Decrypt(account.PersonId, "email", account.EmailCiphertext))
            eligible = await consultations.ReadAsync(data => data.EventNotices.Any(n => n.Id == payload.Token
                && n.Kind == (payload.Kind == "GroupConfirmation" ? "EventConfirmed" : "EventAcceptanceSummary") && n.PersonId == account.PersonId && !n.Cancelled
                && data.Participations.Any(p => p.Id == n.ParticipationId && p.PersonId == account.PersonId && p.State == "Confirmed"
                    && (payload.Kind == "GroupConfirmation" || p.AcceptedAt is not null))
                && data.Events.Any(e => e.Id == n.EventId && e.State != "Cancelled" && e.ScheduleVersion == n.ScheduleVersion
                    && (payload.Kind != "GroupConfirmation" || PaCT.Api.Consultations.GroupEvents.IsFree(e.Service)))), ct);
        if (payload.Kind == "PackReminder" && consultations is not null && account is { Role: Roles.Client, ClosedAt: null, PersonActive: true, LinkStatus: "Verified", EmailConfirmedAt: not null }
            && payload.Recipient == security.Decrypt(account.PersonId, "email", account.EmailCiphertext))
            eligible = await consultations.ReadAsync(data => data.PackNotices.Any(n => n.Id == payload.Token && n.PersonId == account.PersonId
                && !n.Cancelled && n.Kind.StartsWith("PackExpiry:") && n.DueAt <= time.GetUtcNow() && n.ExpiresAt > time.GetUtcNow()
                && PaCT.Api.Consultations.SessionPacks.Remaining(data, n.PackId) > 0), ct);
        if (payload.Kind is "PrepaymentApproval" or "BookingConfirmation" or "AppointmentReminder" or "AppointmentSharedInformation"
            && consultations is not null && job.CreatedAt.AddHours(24) > now && job.Id == payload.Token
            && account is { Role: Roles.Client, ClosedAt: null, PersonActive: true, LinkStatus: "Verified", EmailConfirmedAt: not null }
            && payload.Recipient == security.Decrypt(account.PersonId, "email", account.EmailCiphertext))
            eligible = await consultations.ReadAsync(data => data.Notices.Any(n => n.Id == payload.Token && n.PersonId == account.PersonId
                && data.Consultations.Any(c => c.Id == n.ConsultationId && c.PersonId == account.PersonId
                    && PaCT.Api.Consultations.AppointmentCommunications.EmailKind(n, c, time.GetUtcNow()) == payload.Kind)), ct);
        var state = eligible ? await transport.SendAsync(payload, ct) : "Cancelled";
        await store.CompleteEmailAsync(job.Id, state, time.GetUtcNow().UtcDateTime, ct);
        return true;
    }
}
