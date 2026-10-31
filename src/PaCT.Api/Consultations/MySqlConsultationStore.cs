using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PaCT.Api.Consultations;

public interface IConsultationStore
{
    Task<T> ReadAsync<T>(Func<ConsultationData, T> read, CancellationToken ct);
    Task<ConversationPage> ReadConversationAsync(string id, ConsultationActor actor, long? before, CancellationToken ct) => ReadAsync(data => ConsultationConversation.Page(data, id, actor, before), ct);
    Task<T> ReadAgendaAsync<T>(Func<ConsultationData, T> read, CancellationToken ct) => ReadAsync(read, ct);
    Task<T> ReadEventCatalogueAsync<T>(Func<ConsultationData, T> read, CancellationToken ct) => ReadAsync(read, ct);
    Task<ConsultationResult> ExecuteAsync(ConsultationCommand input, ConsultationActor actor, CancellationToken ct);
    Task<ConsultationResult> SubmitGuestAsync(GuestSubmission input, CancellationToken ct) => throw new IdentityProblem(503, "Não foi possível enviar o pedido. Tenta novamente.");
    Task<ConsultationResult> SubmitEventGuestAsync(string eventId, GuestSubmission input, CancellationToken ct) => throw new IdentityProblem(503, "Não foi possível enviar o pedido. Tenta novamente.");
    Task AdvanceAsync(CancellationToken ct);
    Task<bool> UpdateBalancePushAsync(string id, string state, CancellationToken ct);
    Task<bool> UpdateConsultationPushAsync(string id, string state, CancellationToken ct) => Task.FromResult(false);
}

public sealed class MySqlConsultationStore(DatabaseConnectionSettings settings, IdentitySecurity security, TimeProvider time) : IConsultationStore
{
    private string Encrypt(string id, string field, string value) => Convert.ToBase64String(security.Encrypt(id, "consultation-" + field, value));
    public Task<T> ReadAsync<T>(Func<ConsultationData, T> read, CancellationToken ct) => ReadCore(read, false, ct);
    public Task<T> ReadAgendaAsync<T>(Func<ConsultationData, T> read, CancellationToken ct) => ReadCore(read, true, ct);
    public async Task<ConversationPage> ReadConversationAsync(string id, ConsultationActor actor, long? before, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, ct);
        var page = await LoadConversationPage(connection, transaction, id, actor, before, ct);
        await transaction.CommitAsync(ct); return page;
    }
    internal static async Task<ConversationPage> LoadConversationPage(MySqlConnection connection, MySqlTransaction transaction, string id, ConsultationActor actor, long? before, CancellationToken ct)
    {
        var data = new ConsultationData();
        await using (var command = Command(connection, transaction, "SELECT data FROM consultations WHERE id=@id", ("@id", id)))
        {
            var json = await command.ExecuteScalarAsync(ct);
            if (json is string text) data.Consultations.Add(JsonSerializer.Deserialize<Consultation>(text)!);
        }
        var c = ConsultationConversation.Authorized(data, id, actor);
        var owners = actor.IsManager ? new Dictionary<string, string>() : await PaCT.Api.Clients.ClientAggregation.LoadReadOwnersAsync(connection, transaction, ct);
        var readAccounts = owners.Where(pair => pair.Value == actor.PersonId).Select(pair => pair.Key).Append(actor.AccountId).Distinct().ToArray();
        var readPredicate = actor.IsManager ? "1=1" : "r.account_id IN (" + string.Join(',', readAccounts.Select((_, index) => "@read" + index)) + ")";
        var readParameters = readAccounts.Select((account, index) => ("@read" + index, (object?)account)).ToArray();
        var messages = new List<ConsultationMessage>(); var reads = new List<string>();
        await using (var command = Command(connection, transaction, $"""
            SELECT m.data,EXISTS(SELECT 1 FROM consultation_message_reads r WHERE r.message_id=m.id AND ({readPredicate}))
            FROM consultation_messages m WHERE m.consultation_id=@id AND (@before IS NULL OR m.sequence<@before)
            ORDER BY m.sequence DESC LIMIT 20
            """, readParameters.Concat(new (string, object?)[] { ("@id", id), ("@before", before) }).ToArray()))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct))
            {
                var message = JsonSerializer.Deserialize<ConsultationMessage>(reader.GetString(0))!; messages.Add(message);
                if (reader.GetBoolean(1)) reads.Add(message.Id);
            }
        int unread; long latest, oldest;
        await using (var command = Command(connection, transaction, $"""
            SELECT COALESCE(MAX(m.sequence),0),COALESCE(MIN(m.sequence),0),
                COALESCE(SUM(JSON_UNQUOTE(JSON_EXTRACT(m.data,'$.AuthorIsManager'))=@sender
                    AND NOT EXISTS(SELECT 1 FROM consultation_message_reads r WHERE r.message_id=m.id AND ({readPredicate}))),0)
            FROM consultation_messages m
            WHERE m.consultation_id=@id
            """, readParameters.Concat(new (string, object?)[] { ("@id", id), ("@sender", actor.IsManager ? "false" : "true") }).ToArray()))
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            await reader.ReadAsync(ct); latest = reader.GetInt64(0); oldest = reader.GetInt64(1); unread = reader.GetInt32(2);
        }
        var page = messages.OrderBy(m => m.Sequence).ToArray();
        return new(c, page, reads.ToArray(), unread, latest, page.Length > 0 && oldest < page[0].Sequence);
    }
    public Task<T> ReadEventCatalogueAsync<T>(Func<ConsultationData, T> read, CancellationToken ct) =>
        Write((_, _, data) => Task.FromResult(read(data)), ct, eventCatalogue: true, synchronizeClock: true);
    internal static async Task<ConsultationData> LoadEventCatalogue(MySqlConnection connection, MySqlTransaction transaction, CancellationToken ct)
    {
        var data = new ConsultationData();
        await using (var command = Command(connection, transaction, "SELECT data FROM group_events ORDER BY id"))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) data.Events.Add(JsonSerializer.Deserialize<GroupEvent>(reader.GetString(0))!);
        await FillPublicParticipations(connection, transaction, data, ct);
        return data;
    }
    private static async Task FillPublicParticipations(MySqlConnection connection, MySqlTransaction transaction, ConsultationData data, CancellationToken ct)
    {
        // Capacity reads do not load contact ciphertext, notes or the credit ledger.
        await using (var command = Command(connection, transaction, "SELECT id,event_id,person_id,JSON_UNQUOTE(JSON_EXTRACT(data,'$.State')),JSON_EXTRACT(data,'$.ProtectedSeat') FROM event_participations ORDER BY id"))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) data.Participations.Add(new(reader.GetGuid(0).ToString(), reader.GetGuid(1).ToString(), reader.IsDBNull(2) ? null : reader.GetGuid(2).ToString(), reader.GetString(3), DateTimeOffset.UnixEpoch, ProtectedSeat: reader.GetString(4) == "true"));
    }
    private Task<T> ReadCore<T>(Func<ConsultationData, T> read, bool agendaOnly, CancellationToken ct) =>
        Write((_, _, data) => Task.FromResult(read(data)), ct, agendaOnly: agendaOnly, synchronizeClock: true);

    // Persist only lifecycle changes before serving a read. Public snapshots remain stripped of private fields.
    internal static async Task PersistLifecycle(MySqlConnection connection, MySqlTransaction transaction, DateTimeOffset now, CancellationToken ct)
    {
        var data = new ConsultationData();
        async Task Fill<T>(string table, List<T> rows)
        {
            await using var command = Command(connection, transaction, "SELECT data FROM " + table + " ORDER BY id");
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(JsonSerializer.Deserialize<T>(reader.GetString(0))!);
        }
        await Fill("consultations", data.Consultations); await Fill("guest_consultation_requests", data.GuestRequests);
        await Fill("group_events", data.Events); await Fill("event_participations", data.Participations);
        var before = Snapshot(data); ProcessLifecycle.Advance(data, now);
        await Save(connection, transaction, data, before, ct);
    }
    public Task<ConsultationResult> ExecuteAsync(ConsultationCommand input, ConsultationActor actor, CancellationToken ct) => Write(async (connection, transaction, data) =>
    {
        if (!Guid.TryParse(input.OperationId, out _)) throw new IdentityProblem(400, "A operação precisa de identificação válida.");
        await using (var account = Command(connection, transaction,
            "SELECT COUNT(*) FROM accounts a JOIN people p ON p.id=a.origin_person_id WHERE a.id=@account AND a.origin_person_id=@person AND a.closed_at IS NULL AND p.is_active=1 AND ((@manager=0 AND a.role='Client') OR (@manager=1 AND a.role IN ('TechnicalManager','TherapistManager')))",
            ("@account", actor.AccountId), ("@person", actor.PersonId), ("@manager", actor.IsManager)))
            if (Convert.ToInt32(await account.ExecuteScalarAsync(ct)) != 1) throw new IdentityProblem(401, "A conta mudou. Inicia sessão novamente.");
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(input))));
        await using (var previous = Command(connection, transaction, "SELECT author_id,request_hash,result FROM consultation_commands WHERE id=@id", ("@id", input.OperationId)))
        await using (var reader = await previous.ExecuteReaderAsync(ct))
            if (await reader.ReadAsync(ct))
            {
                if (reader.GetGuid(0).ToString() != actor.AccountId || reader.GetString(1) != hash) throw new IdentityProblem(409, "Esta identificação já foi usada para outra operação.");
                return JsonSerializer.Deserialize<ConsultationResult>(reader.GetString(2))!;
            }
        var person = input.Action == "PurchasePack" ? input.PackPurchase?.PersonId : input.Action is "Manual" or "Request" or "Receipt" or "Adjustment" or "LinkGuestRequest" or "JoinEvent" or "LinkEventGuest" ? actor.IsManager ? input.PersonId : actor.PersonId : null;
        if (person is not null)
        {
            await using var check = Command(connection, transaction, """
                SELECT COUNT(*) FROM people p WHERE p.id=@id AND p.is_active=1
                  AND NOT EXISTS(SELECT 1 FROM accounts a WHERE a.origin_person_id=p.id AND a.link_status<>'Verified')
                  AND NOT EXISTS(SELECT 1 FROM client_reviews r WHERE r.person_id=p.id AND r.kind='Registration' AND r.status='Open')
                  AND NOT EXISTS(SELECT 1 FROM accounts a WHERE a.origin_person_id=p.id AND a.role<>'Client')
                """, ("@id", person));
            if (Convert.ToInt32(await check.ExecuteScalarAsync(ct)) != 1) throw new IdentityProblem(409, "Seleciona uma ficha ativa.");
        }
        var before = Snapshot(data);
        var now = time.GetUtcNow();
        var appliedInput = input;
        if (input.Action == "LinkGuestRequest")
        {
            var guest = data.GuestRequests.SingleOrDefault(g => g.Id == input.Id) ?? throw new IdentityProblem(404, "Pedido não encontrado.");
            var personId = await PaCT.Api.Clients.GuestClientIdentity.PrepareApprovalAsync(
                PaCT.Api.Clients.MySqlClientStore.InTransaction(connection, transaction, ct), guest, input, actor, now, security);
            appliedInput = input with { PersonId = personId, ConditionsAccepted = true };
            // The verified identity decision may have reassigned existing records in this transaction.
            data = await Load(connection, transaction, ct); before = Snapshot(data);
            appliedInput = appliedInput with { Version = data.GuestRequests.Single(g => g.Id == input.Id).Version };
        }
        // Compare the reviewed revision with the locked snapshot before housekeeping can
        // increment unrelated expired-record versions. Occupation checks still use now.
        var reviewedSchedule = input.Action == "PublishAvailability" || input.Action == "Manual" && input.ManualReviewRevision is not null;
        ConsultationResult result;
        if (reviewedSchedule)
        {
            result = ConsultationRules.Apply(data, appliedInput, actor, now, Encrypt);
            ConsultationRules.Advance(data, now);
        }
        else
        {
            ConsultationRules.Advance(data, now);
            result = ConsultationRules.Apply(data, appliedInput, actor, now, Encrypt);
        }
        await QueuePackReminders(connection, transaction, data, ct);
        await QueueGroupSummaries(connection, transaction, data, ct);
        await QueueAppointmentEmails(connection, transaction, data, ct);
        await Save(connection, transaction, data, before, ct);
        await using var record = Command(connection, transaction, "INSERT INTO consultation_commands(id,author_id,request_hash,result,created_at) VALUES(@id,@author,@hash,@result,@now)",
            ("@id", input.OperationId), ("@author", actor.AccountId), ("@hash", hash), ("@result", JsonSerializer.Serialize(result)), ("@now", time.GetUtcNow().UtcDateTime));
        await record.ExecuteNonQueryAsync(ct); return result;
    }, ct);
    public Task<ConsultationResult> SubmitGuestAsync(GuestSubmission input, CancellationToken ct) => Write(async (connection, transaction, data) =>
    {
        var count = data.GuestRequests.Count;
        var before = Snapshot(data);
        var result = GuestConsultations.Submit(data, input, time.GetUtcNow(), Encrypt);
        if (data.GuestRequests.Count > count) await PaCT.Api.Clients.MySqlClientStore.CreateGuestAsync(connection, transaction, data.GuestRequests.Single(g => g.Id == result.Id).PersonId!, input, security, time.GetUtcNow().UtcDateTime, ct);
        await Save(connection, transaction, data, before, ct); return result;
    }, ct);
    public Task<ConsultationResult> SubmitEventGuestAsync(string eventId, GuestSubmission input, CancellationToken ct) => Write(async (connection, transaction, data) =>
    {
        var count = data.Participations.Count;
        var before = Snapshot(data); var result = GroupEvents.SubmitGuest(data, eventId, input, time.GetUtcNow(), Encrypt);
        if (data.Participations.Count > count) await PaCT.Api.Clients.MySqlClientStore.CreateGuestAsync(connection, transaction, data.Participations.Single(p => p.Id == result.Id).PersonId!, input, security, time.GetUtcNow().UtcDateTime, ct);
        await Save(connection, transaction, data, before, ct); return result;
    }, ct);
    public async Task AdvanceAsync(CancellationToken ct) => await Write(async (connection, transaction, data) =>
    {
        var before = Snapshot(data); ConsultationRules.Advance(data, time.GetUtcNow());
        await QueuePackReminders(connection, transaction, data, ct);
        await QueueGroupSummaries(connection, transaction, data, ct);
        await QueueAppointmentEmails(connection, transaction, data, ct);
        await Save(connection, transaction, data, before, ct); return true;
    }, ct);
    public Task<bool> UpdateBalancePushAsync(string id, string state, CancellationToken ct) => Write(async (connection, transaction, data) =>
    {
        var before = Snapshot(data); var index = data.BalanceNotices.FindIndex(n => n.Id == id);
        if (index < 0 || state is not ("Sending" or "Submitted" or "Uncertain" or "Failed")) return false;
        var notice = data.BalanceNotices[index];
        if (state == "Sending" && (notice.ClosedAt is not null || notice.PushState != "Pending")) return false;
        data.BalanceNotices[index] = notice with { PushState = state,
            PushAttemptedAt = state == "Sending" ? time.GetUtcNow() : notice.PushAttemptedAt,
            PushSentAt = state == "Submitted" ? time.GetUtcNow() : notice.PushSentAt };
        await Save(connection, transaction, data, before, ct); return true;
    }, ct);
    public Task<bool> UpdateConsultationPushAsync(string id, string state, CancellationToken ct) => Write(async (connection, transaction, data) =>
    {
        var before = Snapshot(data);
        if (!ConsultationPush.ChangeState(data, id, state, time.GetUtcNow())) return false;
        await Save(connection, transaction, data, before, ct); return true;
    }, ct);
    private async Task<T> Write<T>(Func<MySqlConnection, MySqlTransaction, ConsultationData, Task<T>> action, CancellationToken ct,
        bool agendaOnly = false, bool eventCatalogue = false, bool synchronizeClock = false)
    {
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
        await using var gate = new MySqlCommand("SELECT GET_LOCK('pact0.2_db:client-writes',5)", connection);
        if (Convert.ToInt32(await gate.ExecuteScalarAsync(ct)) != 1) throw new IdentityProblem(409, "Existe outra operação em curso. Atualiza antes de tentar novamente.");
        try
        {
            await using var transaction = await connection.BeginTransactionAsync(ct);
            if (synchronizeClock) await PersistLifecycle(connection, transaction, time.GetUtcNow(), ct);
            var data = eventCatalogue ? await LoadEventCatalogue(connection, transaction, ct) : await Load(connection, transaction, ct, agendaOnly);
            var result = await action(connection, transaction, data);
            await transaction.CommitAsync(ct); return result;
        }
        finally
        {
            await using var release = new MySqlCommand("SELECT RELEASE_LOCK('pact0.2_db:client-writes')", connection);
            await release.ExecuteScalarAsync(CancellationToken.None);
        }
    }
    internal async Task QueueGroupSummaries(MySqlConnection connection, MySqlTransaction transaction, ConsultationData data, CancellationToken ct)
    {
        for (var i = 0; i < data.EventNotices.Count; i++)
        {
            var notice = data.EventNotices[i];
            var freeConfirmation = notice.Kind == "EventConfirmed" && notice.EmailPending;
            if (notice.Kind != "EventAcceptanceSummary" && !freeConfirmation || notice.EmailQueuedAt is not null || notice.Cancelled || notice.PersonId is null) continue;
            var participation = data.Participations.Single(p => p.Id == notice.ParticipationId);
            var item = data.Events.Single(e => e.Id == notice.EventId);
            if (item.Service.ServiceKind != "Group" || participation.State != "Confirmed"
                || (freeConfirmation ? !GroupEvents.IsFree(item.Service) : GroupEvents.IsFree(item.Service) || participation.AcceptedAt is null)) continue;
            var summary = AppointmentCommunications.Summary(item.Service, item.Definition.StartsAt, item.Definition.EndsAt,
                item.Definition.PublicLocation, GroupPaymentConditions.Mode(item));
            if (string.IsNullOrWhiteSpace(summary.Instructions)) continue;
            if (!await QueueClientEmail(connection, transaction, notice.PersonId, notice.Id, freeConfirmation ? "GroupConfirmation" : "GroupAcceptanceSummary", summary, ct)) continue;
            var now = time.GetUtcNow();
            data.EventNotices[i] = notice with { EmailQueuedAt = now, EmailPending = false };
        }
    }
    internal async Task QueueAppointmentEmails(MySqlConnection connection, MySqlTransaction transaction, ConsultationData data, CancellationToken ct)
    {
        for (var i = 0; i < data.Notices.Count; i++)
        {
            var notice = data.Notices[i];
            if (!notice.EmailPending || notice.EmailQueuedAt is not null || notice.PersonId is null) continue;
            var c = data.Consultations.Single(c => c.Id == notice.ConsultationId);
            var kind = AppointmentCommunications.EmailKind(notice, c, time.GetUtcNow());
            if (kind is null) continue;
            var summary = AppointmentCommunications.Summary(c.Service, c.StartsAt, c.EndsAt, mode: c.FinancialChoice);
            if (AppointmentCommunications.NeedsInstructions(kind) && string.IsNullOrWhiteSpace(summary.Instructions)) continue;
            if (await QueueClientEmail(connection, transaction, notice.PersonId, notice.Id, kind, summary, ct))
                data.Notices[i] = notice with { EmailPending = false, EmailQueuedAt = time.GetUtcNow() };
        }
    }
    private async Task<bool> QueueClientEmail(MySqlConnection connection, MySqlTransaction transaction, string person, string id,
        string kind, AppointmentEmailSummary summary, CancellationToken ct)
    {
        string? account = null; byte[]? address = null;
        await using (var command = Command(connection, transaction, """
            SELECT a.id,p.email_ciphertext FROM accounts a JOIN people p ON p.id=a.origin_person_id
            WHERE a.origin_person_id=@person AND p.is_active=1 AND a.role='Client' AND a.closed_at IS NULL
                AND a.link_status='Verified' AND a.email_confirmed_at IS NOT NULL
            """, ("@person", person)))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            if (await reader.ReadAsync(ct)) { account = reader.GetGuid(0).ToString(); address = (byte[])reader[1]; }
        if (account is null || address is null) return false;
        var payload = new EmailPayload(security.Decrypt(person, "email", address), id, kind, Appointment: summary);
        await MySqlIdentityStore.InsertEmailAsync(connection, transaction, new(id, account,
            security.Encrypt(id, "email-job", JsonSerializer.Serialize(payload)), "Pending", time.GetUtcNow().UtcDateTime), ct);
        return true;
    }
    private async Task QueuePackReminders(MySqlConnection connection, MySqlTransaction transaction, ConsultationData data, CancellationToken ct)
    {
        for (var i = 0; i < data.PackNotices.Count; i++)
        {
            var notice = data.PackNotices[i];
            if (notice.EmailQueuedAt is not null || notice.Cancelled || !notice.Kind.StartsWith("PackExpiry:") || notice.ExpiresAt <= time.GetUtcNow()) continue;
            string? accountId = null; byte[]? email = null;
            await using (var command = Command(connection, transaction, """
                SELECT a.id,p.email_ciphertext FROM accounts a JOIN people p ON p.id=a.origin_person_id
                WHERE p.id=@person AND p.is_active=1 AND a.role='Client' AND a.closed_at IS NULL
                    AND a.link_status='Verified' AND a.email_confirmed_at IS NOT NULL
                """, ("@person", notice.PersonId)))
            await using (var reader = await command.ExecuteReaderAsync(ct))
                if (await reader.ReadAsync(ct)) { accountId = reader.GetGuid(0).ToString(); email = (byte[])reader[1]; }
            if (accountId is null || email is null) continue;
            var payload = new EmailPayload(security.Decrypt(notice.PersonId, "email", email), notice.Id, "PackReminder");
            var id = Guid.NewGuid().ToString(); var now = time.GetUtcNow();
            await MySqlIdentityStore.InsertEmailAsync(connection, transaction, new(id, accountId,
                security.Encrypt(id, "email-job", JsonSerializer.Serialize(payload)), "Pending", now.UtcDateTime), ct);
            data.PackNotices[i] = notice with { EmailQueuedAt = now };
        }
    }
    private static MySqlCommand Command(MySqlConnection connection, MySqlTransaction transaction, string sql, params (string, object?)[] values)
    {
        var command = new MySqlCommand(sql, connection, transaction);
        foreach (var (name, value) in values) command.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return command;
    }
    internal static async Task<ConsultationData> Load(MySqlConnection connection, MySqlTransaction transaction, CancellationToken ct, bool agendaOnly = false)
    {
        var data = new ConsultationData();
        async Task Fill<T>(string table, List<T> destination)
        {
            await using var command = Command(connection, transaction, "SELECT data FROM " + table + " ORDER BY id");
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) destination.Add(JsonSerializer.Deserialize<T>(reader.GetString(0))!);
        }
        await Fill("consultation_services", data.Services); await Fill("availability_windows", data.Windows);
        await Fill("consultations", data.Consultations);
        await Fill("guest_consultation_requests", data.GuestRequests);
        await Fill("group_events", data.Events);
        if (agendaOnly) await FillPublicParticipations(connection, transaction, data, ct);
        if (!agendaOnly)
        {
            await using (var accounts = Command(connection, transaction, """
                SELECT DISTINCT a.origin_person_id FROM accounts a JOIN people p ON p.id=a.origin_person_id
                WHERE a.role='Client' AND a.closed_at IS NULL AND p.is_active=1 AND a.link_status='Verified'
                  AND a.email_confirmed_at IS NOT NULL AND a.password_hash IS NOT NULL
                  AND NOT EXISTS(SELECT 1 FROM client_reviews r WHERE r.person_id=p.id AND r.kind='Registration' AND r.status='Open')
                """))
            await using (var reader = await accounts.ExecuteReaderAsync(ct))
                while (await reader.ReadAsync(ct)) data.ClientAccountPeople.Add(reader.GetGuid(0).ToString());
            foreach (var owner in await PaCT.Api.Clients.ClientAggregation.LoadReadOwnersAsync(connection, transaction, ct)) data.ClientReadOwners.Add(owner.Key, owner.Value);
            await Fill("credit_entries", data.Entries); await Fill("consultation_notices", data.Notices);
            await Fill("balance_notices", data.BalanceNotices);
            await Fill("session_packs", data.Packs); await Fill("pack_uses", data.PackUses); await Fill("pack_notices", data.PackNotices);
            await Fill("event_participations", data.Participations); await Fill("event_cash_entries", data.EventCash);
            await Fill("event_notices", data.EventNotices);
            await Fill("consultation_messages", data.Messages); await Fill("consultation_message_reads", data.MessageReads);
        }
        return data;
    }
    private static IEnumerable<(string Table, string Id, object Value)> Rows(ConsultationData data) =>
        data.Services.Select(x => ("consultation_services", x.Id, (object)x))
        .Concat(data.Events.Select(x => ("group_events", x.Id, (object)x)))
        .Concat(data.Participations.Select(x => ("event_participations", x.Id, (object)x)))
        .Concat(data.EventCash.Select(x => ("event_cash_entries", x.Id, (object)x)))
        .Concat(data.EventNotices.Select(x => ("event_notices", x.Id, (object)x)))
        .Concat(data.Windows.Select(x => ("availability_windows", x.Id, (object)x)))
        .Concat(data.Consultations.Select(x => ("consultations", x.Id, (object)x)))
        .Concat(data.Entries.Select(x => ("credit_entries", x.Id, (object)x)))
        .Concat(data.Notices.Select(x => ("consultation_notices", x.Id, (object)x)))
        .Concat(data.BalanceNotices.Select(x => ("balance_notices", x.Id, (object)x)))
        .Concat(data.GuestRequests.Select(x => ("guest_consultation_requests", x.Id, (object)x)))
        .Concat(data.Packs.Select(x => ("session_packs", x.Id, (object)x)))
        .Concat(data.PackUses.Select(x => ("pack_uses", x.Id, (object)x)))
        .Concat(data.PackNotices.Select(x => ("pack_notices", x.Id, (object)x)))
        .Concat(data.Messages.Select(x => ("consultation_messages", x.Id, (object)x)))
        .Concat(data.MessageReads.Select(x => ("consultation_message_reads", x.Id, (object)x)));
    internal static Dictionary<string, string> Snapshot(ConsultationData data) => Rows(data).ToDictionary(x => x.Id, x => JsonSerializer.Serialize(x.Value, x.Value.GetType()));
    internal static async Task Save(MySqlConnection connection, MySqlTransaction transaction, ConsultationData data, Dictionary<string, string> before, CancellationToken ct)
    {
        foreach (var (table, id, value) in Rows(data))
        {
            var json = JsonSerializer.Serialize(value, value.GetType());
            if (before.TryGetValue(id, out var previous) && previous == json) continue;
            ProcessLifecycle.Validate(value);
            if (before.ContainsKey(id))
            {
                if (table is "credit_entries" or "pack_uses" or "event_cash_entries" or "consultation_messages" or "consultation_message_reads") throw new InvalidOperationException("Historical entries are immutable.");
                var assignments = value is GuestConsultationRequest ? "data=@data,person_id=@person,consultation_id=@consultation" : value is EventParticipation ? "data=@data,person_id=@person" : "data=@data";
                await using var update = Command(connection, transaction, "UPDATE " + table + " SET " + assignments + " WHERE id=@id", ("@data", json), ("@id", id));
                if (value is GuestConsultationRequest linked) { update.Parameters.AddWithValue("@person", (object?)linked.PersonId ?? DBNull.Value); update.Parameters.AddWithValue("@consultation", (object?)linked.ConsultationId ?? DBNull.Value); }
                if (value is EventParticipation linkedParticipation) update.Parameters.AddWithValue("@person", (object?)linkedParticipation.PersonId ?? DBNull.Value);
                if (await update.ExecuteNonQueryAsync(ct) != 1) throw new IdentityProblem(409, "O registo mudou.");
            }
            else
            {
                var columns = "id,data"; var parameters = "@id,@data";
                var values = new List<(string, object?)> { ("@id", id), ("@data", json) };
                if (value is Consultation consultation) { columns += ",person_id"; parameters += ",@person"; values.Add(("@person", consultation.PersonId)); }
                if (value is GroupEvent group) { columns += ",service_id"; parameters += ",@service"; values.Add(("@service", group.Service.Id)); }
                if (value is EventParticipation participation) { columns += ",event_id,person_id,guest_operation_id"; parameters += ",@event,@person,@guestOperation"; values.Add(("@event", participation.EventId)); values.Add(("@person", participation.PersonId)); values.Add(("@guestOperation", participation.GuestOperationId)); }
                if (value is EventCashEntry cash) { columns += ",event_id,participation_id,amount"; parameters += ",@event,@participation,@amount"; values.Add(("@event", cash.EventId)); values.Add(("@participation", cash.ParticipationId)); values.Add(("@amount", cash.Amount)); }
                if (value is EventNotice eventNotice) { columns += ",event_id,participation_id"; parameters += ",@event,@participation"; values.Add(("@event", eventNotice.EventId)); values.Add(("@participation", eventNotice.ParticipationId)); }
                if (value is SessionPack pack) { columns += ",person_id"; parameters += ",@person"; values.Add(("@person", pack.PersonId)); }
                if (value is PackUse usage) { columns += ",person_id,pack_id"; parameters += ",@person,@pack"; values.Add(("@person", usage.PersonId)); values.Add(("@pack", usage.PackId)); }
                if (value is PackNotice packNotice) { columns += ",person_id,pack_id"; parameters += ",@person,@pack"; values.Add(("@person", packNotice.PersonId)); values.Add(("@pack", packNotice.PackId)); }
                if (value is GuestConsultationRequest guest) { columns += ",operation_id,service_id,person_id,consultation_id"; parameters += ",@operation,@service,@person,@consultation"; values.Add(("@operation", guest.OperationId)); values.Add(("@service", guest.Service.Id)); values.Add(("@person", guest.PersonId)); values.Add(("@consultation", guest.ConsultationId)); }
                if (value is BalanceNotice balanceNotice) { columns += ",person_id"; parameters += ",@person"; values.Add(("@person", balanceNotice.PersonId)); }
                if (value is CreditEntry entry) { columns += ",person_id,consultation_id,amount"; parameters += ",@person,@consultation,@amount"; values.Add(("@person", entry.PersonId)); values.Add(("@consultation", entry.ConsultationId)); values.Add(("@amount", entry.Amount)); }
                if (value is ConsultationNotice notice) { columns += ",consultation_id"; parameters += ",@consultation"; values.Add(("@consultation", notice.ConsultationId)); }
                if (value is ConsultationMessage message) { columns += ",consultation_id,author_id,sequence"; parameters += ",@consultation,@author,@sequence"; values.Add(("@consultation", message.ConsultationId)); values.Add(("@author", message.AuthorId)); values.Add(("@sequence", message.Sequence)); }
                if (value is ConsultationMessageRead read) { columns += ",message_id,account_id"; parameters += ",@message,@account"; values.Add(("@message", read.MessageId)); values.Add(("@account", read.AccountId)); }
                await using var insert = Command(connection, transaction, "INSERT INTO " + table + "(" + columns + ") VALUES(" + parameters + ")", values.ToArray());
                await insert.ExecuteNonQueryAsync(ct);
            }
        }
    }
}

public sealed class ConsultationClockWorker(IConsultationStore store, ILogger<ConsultationClockWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await store.AdvanceAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception error) { logger.LogWarning("Consultation clock unavailable: {ErrorType}", error.GetType().Name); }
            try { await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }
}
