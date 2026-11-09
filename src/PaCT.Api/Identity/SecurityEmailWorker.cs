using MailKit.Security;
using MimeKit;
using System.Text.Json;
using System.Text.Json.Nodes;
using PaCT.Api.Management;

namespace PaCT.Api.Identity;

public interface ISecurityEmailTransport
{
    SecurityEmailTransportStatus GetConfigurationStatus();
    void CheckConfiguration();
    Task<string> SendAsync(EmailPayload payload, CancellationToken ct);
}

public sealed class SmtpSecurityEmailTransport(IConfiguration configuration, IInstallationSecrets installation,
    MySqlSitePresentationStore? presentation = null) : ISecurityEmailTransport
{
    public SecurityEmailTransportStatus GetConfigurationStatus()
    {
        try { _ = installation.PublicWebUrl; }
        catch (IdentityProblem) { return new(false, "InstallationConfiguration", "O envio de emails está indisponível: a configuração segura da instalação não está disponível."); }

        if (string.IsNullOrWhiteSpace(configuration["Email:Smtp:Host"])
            || string.IsNullOrWhiteSpace(configuration["Email:Smtp:UserName"])
            || string.IsNullOrWhiteSpace(configuration["Email:Smtp:Password"]))
            return new(false, "MissingSmtpConfiguration", "O envio de emails está indisponível: falta concluir a configuração privada do servidor SMTP.");
        if (!MailboxAddress.TryParse(configuration["Email:Smtp:FromEmail"], out _)
            || !int.TryParse(configuration["Email:Smtp:Port"], out var port) || port is < 1 or > 65535)
            return new(false, "InvalidSmtpConfiguration", "O envio de emails está indisponível: a configuração privada do servidor SMTP não é válida.");
        return new(true, "Ready", "O envio SMTP está configurado para processamento.");
    }

    public void CheckConfiguration()
    {
        var status = GetConfigurationStatus();
        if (!status.Available) throw new IdentityProblem(503, status.Message);
    }

    public async Task<string> SendAsync(EmailPayload payload, CancellationToken ct)
    {
        CheckConfiguration();
        var payment = payload.Kind is "PrepaymentApproval" or "GroupAcceptanceSummary" && presentation is not null
            ? SitePresentation.PublicPayment(await presentation.PublishedAsync(ct)) : null;
        var content = SecurityEmailContent.Create(payload, installation.PublicWebUrl, payment);
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
    internal static (string Subject, string Body) Create(EmailPayload payload, string publicWebUrl, JsonObject? payment = null) => payload.Kind switch
    {
        "GroupAcceptanceSummary" or "GroupConfirmation" or "EventCancelled" or "EventParticipationClosed" or "EventReminder24" => GroupSummary(payload, publicWebUrl, payment),
        "PrepaymentApproval" or "BookingConfirmation" or "AppointmentReminder" or "AppointmentSharedInformation" => AppointmentContent(payload, publicWebUrl, payment),
        "ConfirmEmail" => ("PaCT — confirma o teu email", "Confirma o email da tua conta de gestão PaCT.\n\n"
            + publicWebUrl + "/#confirm-email=" + Uri.EscapeDataString(payload.Token)
            + "\n\nO link é pessoal e válido durante 24 horas. Abri-lo não confirma a ação. Se não fizeste este pedido, ignora esta mensagem."),
        "ClientConfirmEmail" => ("PaCT — confirma o teu email", "Para concluir o registo da tua conta de cliente PaCT:\n"
            + "• Abre o link abaixo, introduz o email do registo e carrega em Confirmar.\n"
            + "• Depois de confirmares o email, define a tua palavra-passe.\n\n"
            + publicWebUrl + "/#confirm-email=" + Uri.EscapeDataString(payload.Token) + "&client=1"
            + "\n\n• O link é pessoal, válido durante 24 horas e de uso único.\n"
            + "• Abrir o link não confirma o email nem inicia sessão.\n"
            + "• Se não fizeste este pedido, ignora esta mensagem."),
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
        "PasswordRecovery" => ("PaCT — recupera o acesso à tua conta", "Recebemos um pedido para recuperares o acesso à tua conta PaCT. Usa este link para escolheres uma nova palavra-passe.\n\n"
            + publicWebUrl + "/#recover-password=" + Uri.EscapeDataString(payload.Token)
            + "\n\nO link é pessoal, de uso único e válido durante 30 minutos. Se não fizeste este pedido, ignora esta mensagem."),
        "PackReminder" => ("PaCT — lembrete do teu pack", "Faltam dois meses para a referência de um ano do teu pack. Consulta as sessões disponíveis na tua área PaCT e combina a sua utilização com a terapeuta.\n\n"
            + publicWebUrl + "/#inicio\n\nAs sessões não são retiradas nem bloqueadas automaticamente por esta data."),
        _ => throw new InvalidOperationException("Unknown security email kind.")
    };
    private static (string Subject, string Body) GroupSummary(EmailPayload payload, string publicWebUrl, JsonObject? payment)
    {
        var summary = payload.Appointment ?? throw new InvalidOperationException("Missing group acceptance summary.");
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Europe/Lisbon");
        var date = TimeZoneInfo.ConvertTime(summary.StartsAt, zone).ToString("dd/MM/yyyy HH:mm");
        var end = TimeZoneInfo.ConvertTime(summary.EndsAt, zone).ToString("HH:mm");
        if (payload.Kind is "EventCancelled" or "EventParticipationClosed" or "EventReminder24")
            return (payload.Kind == "EventCancelled" ? "PaCT — evento cancelado" : payload.Kind == "EventReminder24" ? "PaCT — lembrete do evento" : "PaCT — participação tratada",
                (payload.Kind == "EventCancelled" ? "O evento foi cancelado." : payload.Kind == "EventReminder24" ? "O evento começa dentro de 24 horas." : "A tua participação foi tratada. Consulta o resultado e a informação partilhada na PaCT.")
                + "\n\n" + summary.Service + "\n" + date + " (hora de Lisboa)\n\n" + summary.Instructions + "\n\n" + publicWebUrl + "/#agenda");
        if (summary.PaymentMode != "Prepayment")
            return ("PaCT — inscrição confirmada", "A tua inscrição ficou confirmada.\n\n"
                + summary.Service + "\n" + date + " — " + end + " (hora de Lisboa)\n\n" + summary.Instructions
                + "\n\nConsulta a tua inscrição na PaCT:\n" + publicWebUrl + "/#agenda");
        var amount = summary.Price is { } price ? price.ToString("0.00", System.Globalization.CultureInfo.GetCultureInfo("pt-PT")) + " €" : summary.PaymentMode == "Contribution" ? "Contribuição livre" : "Valor a combinar";
        var next = summary.PaymentMode == "Prepayment"
            ? "Aceitaste as condições e indicaste que vais efetuar o pagamento de seguida. Tens oito horas para o fazer. O recebimento será confirmado pela terapeuta."
            : summary.PaymentMode == "Contribution" ? "Aceitaste as condições. Escolhes a tua contribuição e pagas depois da consulta."
            : "Aceitaste as condições. O pagamento é feito depois da consulta.";
        return ("PaCT — resumo da inscrição e das condições aceites", "A tua inscrição ficou confirmada.\n\n"
            + summary.Service + "\n" + date + " — " + end + " (hora de Lisboa)\n" + summary.Instructions + "\nValor: " + amount
            + "\n\n" + next + "\nForma de pagamento"
            + (payment is null || payment["iban"]?.GetValue<string>() is { Length: > 0 } ? "\n- Transferência bancária" : "")
            + (payment is null || payment["mbWay"]?.GetValue<string>() is { Length: > 0 } ? "\n- MB WAY" : "")
            + "\n- Dinheiro, combinado com a terapeuta."
            + "\nOs meios e as condições que aceitaste estão disponíveis na tua inscrição na PaCT."
            + "\n\n" + publicWebUrl + "/#agenda");
    }
    private static (string Subject, string Body) AppointmentContent(EmailPayload payload, string publicWebUrl, JsonObject? payment)
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
            var methods = payment ?? SitePresentation.PublicPayment(SitePresentation.Default);
            body += "\n\nForma de pagamento";
            if (methods["iban"]?.GetValue<string>() is { Length: > 0 } iban)
            {
                body += "\nTransferência bancária\nIBAN: " + iban;
                if (methods["bic"]?.GetValue<string>() is { Length: > 0 } bic) body += "\nBIC/SWIFT: " + bic;
                body += "\n" + methods["transferNote"]?.GetValue<string>();
            }
            if (methods["mbWay"]?.GetValue<string>() is { Length: > 0 } mbWay)
                body += "\nMB WAY: " + mbWay + "\n" + methods["mbWayNote"]?.GetValue<string>();
            body += "\nDinheiro: " + methods["advanceCashNote"]?.GetValue<string>();
        }
        else body += "\n\n" + summary.Instructions;
        return (subject, body + "\n\n" + publicWebUrl + "/#agenda");
    }
}

public sealed class SecurityEmailWorker(IIdentityStore store, ITherapistInvitationStore invitations, IdentitySecurity security, IInstallationSecrets installation,
    ISecurityEmailTransport transport, TimeProvider time, ILogger<SecurityEmailWorker> logger, ClientAccessService? clientAccess = null, PasswordChangeService? passwords = null,
    PaCT.Api.Consultations.IConsultationStore? consultations = null, SecurityEmailHealth? health = null, SecurityAuditWriter? audit = null) : BackgroundService
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
                health?.RecordFailure(error is IdentityProblem ? "Configuration" : "Worker", time.GetUtcNow().UtcDateTime);
                if (audit is not null)
                    await audit.TryRecordAsync(SecurityAuditEventFactory.Background(time.GetUtcNow().UtcDateTime, "EmailWorkerError", "Error", "High", null, null,
                        error is IdentityProblem ? "configuration" : "worker"), CancellationToken.None);
                try { await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            }
        }
    }

    internal async Task<bool> ProcessNextAsync(CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        health?.RecordWorkerActivity(now);
        var configuration = transport.GetConfigurationStatus();
        health?.ObserveConfiguration(configuration, now);
        transport.CheckConfiguration();
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
        if (payload.Kind is "PasswordChange" or "PasswordRecovery" && passwords is not null)
            eligible = await passwords.CanSendAsync(job, payload, ct);
        if (payload.Kind is "GroupAcceptanceSummary" or "GroupConfirmation" or "EventCancelled" or "EventParticipationClosed" or "EventReminder24" && consultations is not null && job.CreatedAt.AddHours(24) > now && job.Id == payload.Token
            && account is { Role: Roles.Client, ClosedAt: null, PersonActive: true, LinkStatus: "Verified", EmailConfirmedAt: not null }
            && payload.Recipient == security.Decrypt(account.PersonId, "email", account.EmailCiphertext))
            eligible = await consultations.ReadAsync(data => data.EventNotices.Any(n => n.Id == payload.Token
                && n.Kind == (payload.Kind == "GroupConfirmation" ? "EventConfirmed" : payload.Kind == "GroupAcceptanceSummary" ? "EventAcceptanceSummary" : payload.Kind) && n.PersonId == account.PersonId && !n.Cancelled
                && data.Participations.Any(p => p.Id == n.ParticipationId && p.PersonId == account.PersonId && (payload.Kind == "EventCancelled" ? p.State == "Cancelled" : payload.Kind == "EventParticipationClosed" ? p.Attendance is not null : p.State == "Confirmed")
                    && (payload.Kind != "GroupAcceptanceSummary" || p.AcceptedAt is not null))
                && data.Events.Any(e => e.Id == n.EventId && (payload.Kind == "EventCancelled" || e.State != "Cancelled") && e.ScheduleVersion == n.ScheduleVersion
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
        health?.RecordOutcome(state, time.GetUtcNow().UtcDateTime);
        await store.CompleteEmailAsync(job.Id, state, time.GetUtcNow().UtcDateTime, ct);
        if (audit is not null && state is "Failed" or "Uncertain")
            await audit.TryRecordAsync(SecurityAuditEventFactory.Background(time.GetUtcNow().UtcDateTime,
                state == "Failed" ? "EmailFailed" : "EmailUncertain", state == "Failed" ? "Failure" : "Uncertain",
                state == "Failed" ? "Warning" : "High", job.AccountId, account?.Role, state.ToLowerInvariant(), job.Id), CancellationToken.None);
        return true;
    }
}
