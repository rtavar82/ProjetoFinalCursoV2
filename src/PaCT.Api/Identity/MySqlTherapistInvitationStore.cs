using System.Data.Common;
using MySql.Data.MySqlClient;

namespace PaCT.Api.Identity;

public sealed partial class MySqlIdentityStore : ITherapistInvitationStore
{
    public Task<IdentityAccount?> FindTherapistAsync(CancellationToken ct) => FindAccountAsync("a.role = @value", Roles.TherapistManager, ct);

    public Task<TherapistInvitation?> LatestInvitationAsync(CancellationToken ct) => ReadInvitationAsync("ORDER BY `sequence` DESC LIMIT 1", null, ct);

    public Task<TherapistInvitation?> FindInvitationAsync(string id, CancellationToken ct) => ReadInvitationAsync("WHERE id=@id", id, ct);

    private async Task<TherapistInvitation?> ReadInvitationAsync(string clause, string? id, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var command = Command(connection, "SELECT * FROM therapist_invitations " + clause, null, ("@id", id));
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? ReadInvitation(reader) : null;
    }

    internal static TherapistInvitation ReadInvitation(DbDataReader reader) => new(Identifier(reader, "id"), Identifier(reader, "created_by_account_id"),
        (byte[])reader["email_ciphertext"], (byte[])reader["email_hash"], reader.GetString(reader.GetOrdinal("security_stamp")),
        Identifier(reader, "email_job_id"), reader.GetDateTime(reader.GetOrdinal("created_at")), reader.GetDateTime(reader.GetOrdinal("expires_at")),
        Date(reader, "cancelled_at"), Date(reader, "accepted_at"), reader.IsDBNull(reader.GetOrdinal("accepted_by_account_id")) ? null : Identifier(reader, "accepted_by_account_id"));

    private static async Task LockInvitationIssuerAsync(MySqlConnection connection, MySqlTransaction transaction, string id, CancellationToken ct)
    {
        await using var gate = Command(connection, """
            SELECT a.id FROM accounts a JOIN people p ON p.id=a.origin_person_id
            WHERE a.id=@id AND a.role='TechnicalManager' AND a.closed_at IS NULL AND p.is_active=1
              AND a.link_status='Verified' AND a.email_confirmed_at IS NOT NULL AND (a.passkey_enabled_at IS NOT NULL OR a.two_factor_enabled_at IS NOT NULL) FOR UPDATE
            """, transaction, ("@id", id));
        if (await gate.ExecuteScalarAsync(ct) is null) throw new IdentityProblem(403, "É necessária uma conta técnica ativa, com email confirmado e 2FA.");
    }

    private static async Task EnsureTherapistAbsentAsync(MySqlConnection connection, MySqlTransaction transaction, CancellationToken ct)
    {
        await using var command = Command(connection, "SELECT EXISTS(SELECT 1 FROM accounts WHERE role='TherapistManager')", transaction);
        if (Convert.ToBoolean(await command.ExecuteScalarAsync(ct)))
            throw new IdentityProblem(409, "A instalação já tem uma conta de gestora-terapeuta. Não é possível criar outra.");
    }

    public async Task CreateInvitationAsync(TherapistInvitation invitation, EmailJob email, string? replaceInvitationId, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await LockInvitationIssuerAsync(connection, transaction, invitation.CreatedByAccountId, ct);
        await EnsureTherapistAbsentAsync(connection, transaction, ct);
        TherapistInvitation? previous;
        await using (var query = Command(connection, "SELECT * FROM therapist_invitations WHERE cancelled_at IS NULL AND accepted_at IS NULL FOR UPDATE", transaction))
        await using (var reader = await query.ExecuteReaderAsync(ct)) previous = await reader.ReadAsync(ct) ? ReadInvitation(reader) : null;
        if (previous?.Id != replaceInvitationId) throw new IdentityProblem(409, "O convite mudou entretanto. Atualiza a informação antes de voltar a enviar.");
        if (previous is not null)
        {
            await using var cancel = Command(connection, "UPDATE therapist_invitations SET cancelled_at=@now WHERE id=@id", transaction,
                ("@id", previous.Id), ("@now", invitation.CreatedAt));
            await cancel.ExecuteNonQueryAsync(ct);
            await CancelInvitationEmailAsync(connection, transaction, previous.EmailJobId, invitation.CreatedAt, ct);
        }
        await InsertEmailAsync(connection, transaction, email, ct);
        await using var insert = Command(connection, """
            INSERT INTO therapist_invitations (id,created_by_account_id,email_ciphertext,email_hash,security_stamp,email_job_id,created_at,expires_at)
            VALUES (@id,@issuer,@email,@hash,@stamp,@job,@now,@expires)
            """, transaction, ("@id", invitation.Id), ("@issuer", invitation.CreatedByAccountId), ("@email", invitation.EmailCiphertext),
            ("@hash", invitation.EmailHash), ("@stamp", invitation.SecurityStamp), ("@job", invitation.EmailJobId),
            ("@now", invitation.CreatedAt), ("@expires", invitation.ExpiresAt));
        await insert.ExecuteNonQueryAsync(ct);
        await transaction.CommitAsync(ct);
    }

    public async Task<bool> CancelInvitationAsync(string id, string createdByAccountId, DateTime now, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await LockInvitationIssuerAsync(connection, transaction, createdByAccountId, ct);
        TherapistInvitation? invitation;
        await using (var query = Command(connection, "SELECT * FROM therapist_invitations WHERE id=@id FOR UPDATE", transaction, ("@id", id)))
        await using (var reader = await query.ExecuteReaderAsync(ct)) invitation = await reader.ReadAsync(ct) ? ReadInvitation(reader) : null;
        if (invitation is null || invitation.CreatedByAccountId != createdByAccountId || invitation.AcceptedAt is not null || invitation.CancelledAt is not null) return false;
        await using var cancel = Command(connection, "UPDATE therapist_invitations SET cancelled_at=@now WHERE id=@id", transaction, ("@id", id), ("@now", now));
        await cancel.ExecuteNonQueryAsync(ct);
        await CancelInvitationEmailAsync(connection, transaction, invitation.EmailJobId, now, ct);
        await transaction.CommitAsync(ct);
        return true;
    }

    private static async Task CancelInvitationEmailAsync(MySqlConnection connection, MySqlTransaction transaction, string id, DateTime now, CancellationToken ct)
    {
        await using var command = Command(connection, "UPDATE security_emails SET state='Cancelled',updated_at=@now WHERE id=@id AND state IN ('Pending','Sending')", transaction, ("@id", id), ("@now", now));
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task RegisterTherapistAsync(TherapistInvitation invitation, PrivatePerson person, IdentityAccount account, EmailJob email, DateTime now, CancellationToken ct)
    {
        if (account.Role != Roles.TherapistManager || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(account.EmailHash, invitation.EmailHash))
            throw new InvalidOperationException("The registration must match the invitation recipient and fixed therapist role.");
        await using var connection = await OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await LockInvitationIssuerAsync(connection, transaction, invitation.CreatedByAccountId, ct);
        await EnsureTherapistAbsentAsync(connection, transaction, ct);
        var lockedAt = (time ?? TimeProvider.System).GetUtcNow().UtcDateTime;
        if (lockedAt > now) now = lockedAt;
        TherapistInvitation? current;
        await using (var query = Command(connection, "SELECT * FROM therapist_invitations WHERE id=@id FOR UPDATE", transaction, ("@id", invitation.Id)))
        await using (var reader = await query.ExecuteReaderAsync(ct)) current = await reader.ReadAsync(ct) ? ReadInvitation(reader) : null;
        if (current is null || !current.IsOpen(now) || current.SecurityStamp != invitation.SecurityStamp)
            throw new IdentityProblem(409, "O convite expirou, foi cancelado ou já foi utilizado. Pede um novo convite ao gestor técnico.");
        try
        {
            await InsertIdentityAsync(connection, transaction, person, account, email, ct);
            await using var accepted = Command(connection, "UPDATE therapist_invitations SET accepted_at=@now,accepted_by_account_id=@account WHERE id=@id", transaction,
                ("@id", invitation.Id), ("@account", account.Id), ("@now", now));
            await accepted.ExecuteNonQueryAsync(ct);
            await CancelInvitationEmailAsync(connection, transaction, invitation.EmailJobId, now, ct);
            await transaction.CommitAsync(ct);
        }
        catch (MySqlException error) when (error.Number == 1062)
        {
            throw new IdentityProblem(409, "Já existe uma conta com este email ou uma gestora-terapeuta nesta instalação. O convite não foi consumido por esta tentativa.");
        }
    }
}
