using System.Text.Json;

namespace PaCT.Api.Identity;

public sealed class TherapistInvitationService(ITherapistInvitationStore invitations, IIdentityStore accounts, IdentityService identity,
    IdentitySecurity security, ISecurityEmailTransport transport, TimeProvider time)
{
    private DateTime Now => time.GetUtcNow().UtcDateTime;

    public async Task<object> ManagementAsync(CancellationToken ct)
    {
        var therapist = await invitations.FindTherapistAsync(ct);
        if (therapist is not null) return new
        {
            therapist = new { therapist.DisplayName, email = security.Decrypt(therapist.PersonId, "email", therapist.EmailCiphertext),
                state = therapist.ClosedAt is not null ? "Closed" : therapist.EmailConfirmedAt is null ? "ConfirmEmail"
                    : therapist.PasskeyEnabledAt is not null || therapist.TwoFactorEnabledAt is not null ? "Ready" : "ConfigureAuthenticator" },
            invitation = (object?)null
        };
        var invitation = await invitations.LatestInvitationAsync(ct);
        return new { therapist = (object?)null, invitation = invitation is null ? null : new
        {
            invitation.Id, email = security.Decrypt(invitation.Id, "invitation-email", invitation.EmailCiphertext),
            createdAtUtc = DateTime.SpecifyKind(invitation.CreatedAt, DateTimeKind.Utc),
            expiresAtUtc = DateTime.SpecifyKind(invitation.ExpiresAt, DateTimeKind.Utc),
            state = invitation.AcceptedAt is not null ? "Accepted" : invitation.CancelledAt is not null ? "Cancelled" : invitation.ExpiresAt <= Now ? "Expired" : "Pending",
            emailState = await accounts.EmailStateAsync(invitation.EmailJobId, ct)
        } };
    }

    public async Task CreateAsync(string issuerId, TherapistInvitationRequest input, CancellationToken ct)
    {
        transport.CheckConfiguration();
        var email = IdentityValidation.Email(input.Email);
        var hash = security.EmailHash(email);
        if (await accounts.FindByEmailAsync(hash, ct) is not null)
            throw new IdentityProblem(409, "Este email já pertence a uma conta. Indica o email da pessoa que será gestora-terapeuta.");
        if (input.ReplaceInvitationId is not null && !Guid.TryParse(input.ReplaceInvitationId, out _))
            throw new IdentityProblem(400, "A referência do convite não é válida. Atualiza a informação.");
        var id = Guid.NewGuid().ToString("D");
        var jobId = Guid.NewGuid().ToString("D");
        var now = Now;
        var invitation = new TherapistInvitation(id, issuerId, security.Encrypt(id, "invitation-email", email), hash,
            Guid.NewGuid().ToString("D"), jobId, now, now.AddHours(24));
        var payload = new EmailPayload(email, security.ProtectInvitation(invitation), "TherapistInvitation", id);
        var job = new EmailJob(jobId, issuerId, security.Encrypt(jobId, "email-job", JsonSerializer.Serialize(payload)), "Pending", now);
        await invitations.CreateInvitationAsync(invitation, job, input.ReplaceInvitationId, ct);
    }

    public async Task<bool> CancelAsync(string id, string issuerId, CancellationToken ct) =>
        Guid.TryParse(id, out _) && await invitations.CancelInvitationAsync(id, issuerId, Now, ct);

    public async Task<TherapistInvitation?> ValidInvitationAsync(string? token, CancellationToken ct)
    {
        if (!security.TryReadInvitation(token, out var action)) return null;
        var invitation = await invitations.FindInvitationAsync(action.InvitationId, ct);
        if (invitation is null || invitation.SecurityStamp != action.Stamp || !invitation.IsOpen(Now)
            || await invitations.FindTherapistAsync(ct) is not null) return null;
        var issuer = await accounts.FindAsync(invitation.CreatedByAccountId, ct);
        return issuer is { Role: Roles.TechnicalManager, ClosedAt: null, PersonActive: true, LinkStatus: "Verified", EmailConfirmedAt: not null }
            && (issuer.PasskeyEnabledAt is not null || issuer.TwoFactorEnabledAt is not null)
            ? invitation : null;
    }

    public object Preview(TherapistInvitation invitation) => new
    {
        email = security.Decrypt(invitation.Id, "invitation-email", invitation.EmailCiphertext),
        expiresAtUtc = DateTime.SpecifyKind(invitation.ExpiresAt, DateTimeKind.Utc)
    };

    public async Task<IdentityAccount> RegisterAsync(TherapistInvitation invitation, TherapistRegistration input, CancellationToken ct)
    {
        transport.CheckConfiguration();
        var email = security.Decrypt(invitation.Id, "invitation-email", invitation.EmailCiphertext);
        var (person, account) = identity.PrepareRegistration(input.FirstName, input.LastName, input.Locality, input.DisplayName,
            email, input.Password, input.ConfirmPassword, Roles.TherapistManager);
        await invitations.RegisterTherapistAsync(invitation, person, account, identity.ConfirmationEmail(account, email), Now, ct);
        return account;
    }
}
