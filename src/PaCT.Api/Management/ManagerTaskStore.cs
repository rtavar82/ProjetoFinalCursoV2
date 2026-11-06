using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Management;

public sealed record NewManagerTask(Guid OperationId, string? Text, bool HighPriority, DateTimeOffset? ReminderAt);
public sealed record ManagerTask(string Id, string Text, bool HighPriority, DateTimeOffset CreatedAt,
    DateTimeOffset? ReminderAt, DateTimeOffset? CompletedAt, string? CompletedByRole);
public sealed record ManagerTaskPage(IReadOnlyList<ManagerTask> Items, int Total, int Page, int PageSize);
public sealed record ManagerTaskReminder(string Id, DateTimeOffset DueAt);

public sealed class ManagerTaskStore(DatabaseConnectionSettings settings, IdentitySecurity security, TimeProvider time)
{
    public const int MaxTextLength = 5000;
    private const string Scope = "manager-task";

    public async Task<ManagerTaskPage> ListAsync(bool completed, int page, CancellationToken ct)
    {
        const int pageSize = 20;
        var filter = completed ? "t.completed_at IS NOT NULL" : "t.completed_at IS NULL";
        var order = completed ? "t.completed_at DESC, t.id" : "t.priority_high DESC, t.created_at, t.id";
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, ct);
        await using var count = MySqlManagementStore.Query(connection, transaction,
            $"SELECT COUNT(*) FROM manager_tasks t WHERE {filter}");
        var total = Convert.ToInt32(await count.ExecuteScalarAsync(ct));
        page = Math.Clamp(page, 1, Math.Max(1, (int)Math.Ceiling(total / (double)pageSize)));

        var tasks = new List<ManagerTask>();
        await using (var query = MySqlManagementStore.Query(connection, transaction, $"""
            SELECT t.id, t.body, t.priority_high, t.created_at, t.reminder_at, t.completed_at, a.role
            FROM manager_tasks t LEFT JOIN accounts a ON t.completed_by=a.id
            WHERE {filter} ORDER BY {order} LIMIT @take OFFSET @skip
            """, ("@take", pageSize), ("@skip", (page - 1) * pageSize)))
        await using (var rows = await query.ExecuteReaderAsync(ct))
        {
            while (await rows.ReadAsync(ct))
            {
                var id = rows.GetGuid(0).ToString("D");
                tasks.Add(new(id, security.Decrypt(id, Scope, (byte[])rows[1]), rows.GetBoolean(2),
                    Utc(rows, 3), OptionalUtc(rows, 4), OptionalUtc(rows, 5), rows.IsDBNull(6) ? null : rows.GetString(6)));
            }
        }
        await transaction.CommitAsync(ct);
        return new(tasks, total, page, pageSize);
    }

    public async Task CreateAsync(NewManagerTask input, string author, CancellationToken ct)
    {
        var body = input.Text?.Trim();
        if (input.OperationId == Guid.Empty || string.IsNullOrEmpty(body) || body.Length > MaxTextLength)
            throw new IdentityProblem(400, "Escreve uma tarefa com até 5 000 caracteres.");
        var id = input.OperationId.ToString("D");
        var reminder = input.ReminderAt?.UtcDateTime;
        var now = time.GetUtcNow().UtcDateTime;
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);

        if (reminder is null || reminder > now)
        {
            await using var insert = MySqlManagementStore.Query(connection, null, """
                INSERT INTO manager_tasks(id, body, priority_high, created_by, created_at, reminder_at, push_state)
                VALUES (@id, @body, @high, @author, @now, @reminder, IF(@reminder IS NULL, NULL, 'Pending'))
                ON DUPLICATE KEY UPDATE id=id
                """, ("@id", id), ("@body", security.Encrypt(id, Scope, body)), ("@high", input.HighPriority),
                ("@author", author), ("@now", now), ("@reminder", reminder));
            await insert.ExecuteNonQueryAsync(ct);
        }
        await using var query = MySqlManagementStore.Query(connection, null,
            "SELECT body, priority_high, reminder_at, created_by FROM manager_tasks WHERE id=@id", ("@id", id));
        await using var row = await query.ExecuteReaderAsync(ct);
        if (!await row.ReadAsync(ct)) throw new IdentityProblem(400, "Escolhe uma data e hora futuras para o lembrete.");
        if (row.GetGuid(3) != Guid.Parse(author) || row.GetBoolean(1) != input.HighPriority
            || OptionalUtc(row, 2)?.UtcDateTime != reminder || security.Decrypt(id, Scope, (byte[])row[0]) != body)
            throw new IdentityProblem(409, "A referência já pertence a outra tarefa.");
    }

    public async Task CompleteAsync(Guid task, string author, CancellationToken ct)
    {
        var id = task.ToString("D");
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        await using var update = MySqlManagementStore.Query(connection, null, """
            UPDATE manager_tasks SET completed_at=@now, completed_by=@author,
                push_state=IF(push_state='Pending', 'Cancelled', push_state)
            WHERE id=@id AND completed_at IS NULL
            """, ("@now", time.GetUtcNow().UtcDateTime), ("@author", author), ("@id", id));
        if (await update.ExecuteNonQueryAsync(ct) != 0) return;
        await using var check = MySqlManagementStore.Query(connection, null,
            "SELECT 1 FROM manager_tasks WHERE id=@id", ("@id", id));
        if (await check.ExecuteScalarAsync(ct) is null) throw new IdentityProblem(404, "A tarefa não foi encontrada.");
    }

    public async Task<IReadOnlyList<ManagerTaskReminder>> RemindersAsync(CancellationToken ct)
    {
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        await using var query = MySqlManagementStore.Query(connection, null, """
            SELECT id, reminder_at FROM manager_tasks
            WHERE completed_at IS NULL AND reminder_read_at IS NULL AND reminder_at<=@now
            ORDER BY reminder_at, id LIMIT 100
            """, ("@now", time.GetUtcNow().UtcDateTime));
        var reminders = new List<ManagerTaskReminder>();
        try
        {
            await using var rows = await query.ExecuteReaderAsync(ct);
            while (await rows.ReadAsync(ct)) reminders.Add(new(rows.GetGuid(0).ToString("D"), Utc(rows, 1)));
        }
        catch (MySqlException error) when (error.Number == 1146) { /* The optional module is not prepared. */ }
        return reminders;
    }

    public async Task ReadReminderAsync(Guid task, CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        await using var update = MySqlManagementStore.Query(connection, null, """
            UPDATE manager_tasks SET reminder_read_at=@now
            WHERE id=@id AND reminder_at<=@now AND reminder_read_at IS NULL AND completed_at IS NULL
            """, ("@now", now), ("@id", task.ToString("D")));
        await update.ExecuteNonQueryAsync(ct);
    }

    internal async Task<IReadOnlyList<string>> PendingPushAsync(CancellationToken ct)
    {
        if (!settings.IsConfigured) return [];
        var now = time.GetUtcNow().UtcDateTime;
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        try
        {
            await using var recover = MySqlManagementStore.Query(connection, null,
                "UPDATE manager_tasks SET push_state='Uncertain' WHERE push_state='Sending' AND push_claimed_at<@expired",
                ("@expired", now.AddMinutes(-15)));
            await recover.ExecuteNonQueryAsync(ct);
            await using var query = MySqlManagementStore.Query(connection, null, """
                SELECT id FROM manager_tasks WHERE completed_at IS NULL AND push_state='Pending' AND reminder_at<=@now
                ORDER BY reminder_at,id LIMIT 100
                """, ("@now", now));
            var ids = new List<string>();
            await using var rows = await query.ExecuteReaderAsync(ct);
            while (await rows.ReadAsync(ct)) ids.Add(rows.GetGuid(0).ToString("D"));
            return ids;
        }
        catch (MySqlException error) when (error.Number == 1146) { return []; }
    }

    internal async Task<bool> ChangePushAsync(string id, string state, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        var now = time.GetUtcNow().UtcDateTime;
        var claim = state == "Sending";
        var sql = claim
            ? "UPDATE manager_tasks SET push_state='Sending', push_claimed_at=@now WHERE id=@id AND completed_at IS NULL AND reminder_at<=@now AND push_state='Pending'"
            : "UPDATE manager_tasks SET push_state=@state WHERE id=@id AND push_state='Sending'";
        await using var update = MySqlManagementStore.Query(connection, null, sql, ("@id", id), ("@now", now), ("@state", state));
        return await update.ExecuteNonQueryAsync(ct) != 0;
    }

    private static DateTimeOffset Utc(System.Data.Common.DbDataReader row, int column) =>
        new(DateTime.SpecifyKind(row.GetDateTime(column), DateTimeKind.Utc));

    private static DateTimeOffset? OptionalUtc(System.Data.Common.DbDataReader row, int column) =>
        row.IsDBNull(column) ? null : Utc(row, column);
}
