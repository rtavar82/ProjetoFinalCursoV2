using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;

namespace PaCT.Api.Identity;

public sealed class MySqlSecurityAuditStore(DatabaseConnectionSettings settings) : ISecurityAuditStore
{
    public async Task RecordAsync(SecurityAuditEvent entry, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        await using var command = Command(connection, """
            INSERT INTO security_audit_events
                (id,occurred_at,event_type,outcome,severity,actor_account_id,actor_role,request_id,http_method,route,status_code,detail,resource_id)
            VALUES (@id,@occurred,@type,@outcome,@severity,@account,@role,@request,@method,@route,@status,@detail,@resource)
            """, ("@id", entry.Id), ("@occurred", entry.OccurredAt), ("@type", entry.EventType),
            ("@outcome", entry.Outcome), ("@severity", entry.Severity), ("@account", (object?)entry.ActorAccountId ?? DBNull.Value),
            ("@role", (object?)entry.ActorRole ?? DBNull.Value), ("@request", (object?)entry.RequestId ?? DBNull.Value),
            ("@method", (object?)entry.HttpMethod ?? DBNull.Value), ("@route", (object?)entry.Route ?? DBNull.Value),
            ("@status", (object?)entry.StatusCode ?? DBNull.Value), ("@detail", (object?)entry.Detail ?? DBNull.Value),
            ("@resource", (object?)entry.ResourceId ?? DBNull.Value));
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task<SecurityAuditPage?> ReadAsync(SecurityAuditQuery query, DateTime now, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);

        var where = "WHERE (@type IS NULL OR event_type=@type) AND (@outcome IS NULL OR outcome=@outcome)";
        var parameters = new (string Name, object? Value)[] { ("@type", (object?)query.EventType ?? DBNull.Value), ("@outcome", (object?)query.Outcome ?? DBNull.Value) };
        try
        {
            int total;
            SecurityAuditSummary summary;
            var summaryParameters = new (string Name, object? Value)[] { ("@cutoff", now.AddHours(-24)) }.Concat(parameters).ToArray();
            await using (var command = Command(connection, $"""
                SELECT COUNT(*),
                    COALESCE(SUM(occurred_at >= @cutoff),0),
                    COALESCE(SUM(outcome IN ('Denied','Blocked','Failure','Error','Uncertain')),0),
                    COALESCE(SUM(event_type='SensitiveDataRead'),0)
                FROM security_audit_events {where}
                """, summaryParameters))
            await using (var reader = (MySqlDataReader)await command.ExecuteReaderAsync(ct))
            {
                await reader.ReadAsync(ct);
                total = Convert.ToInt32(reader.GetValue(0));
                summary = new(total, Convert.ToInt32(reader.GetValue(1)), Convert.ToInt32(reader.GetValue(2)), Convert.ToInt32(reader.GetValue(3)));
            }

            var items = new List<SecurityAuditEvent>();
            var pageParameters = new (string Name, object? Value)[] { ("@limit", query.PageSize), ("@offset", (query.Page - 1) * query.PageSize) }.Concat(parameters).ToArray();
            await using (var command = Command(connection, $"""
                SELECT id,occurred_at,event_type,outcome,severity,actor_account_id,actor_role,request_id,http_method,route,status_code,detail,resource_id
                FROM security_audit_events {where}
                ORDER BY occurred_at DESC,id DESC LIMIT @limit OFFSET @offset
                """, pageParameters))
            await using (var reader = (MySqlDataReader)await command.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                    items.Add(new(Identifier(reader, 0), DateTime.SpecifyKind(reader.GetDateTime(1), DateTimeKind.Utc),
                        reader.GetString(2), reader.GetString(3), reader.GetString(4),
                        reader.IsDBNull(5) ? null : Identifier(reader, 5), Text(reader, 6), Text(reader, 7),
                        Text(reader, 8), Text(reader, 9), reader.IsDBNull(10) ? null : Convert.ToInt32(reader.GetValue(10)),
                        Text(reader, 11), Text(reader, 12)));
            }
            return new(summary, items, total, query.Page, query.PageSize);
        }
        catch (MySqlException error) when (error.Number == 1146)
        {
            // Audit storage is prepared explicitly. The rest of the application can run without it.
            return null;
        }
    }

    private static string Identifier(MySqlDataReader reader, int ordinal) =>
        reader.GetValue(ordinal) is Guid id ? id.ToString("D") : reader.GetString(ordinal);

    private static string? Text(MySqlDataReader reader, int ordinal) => reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);

    private static MySqlCommand Command(MySqlConnection connection, string sql, params (string Name, object? Value)[] values)
    {
        var command = connection.CreateCommand(); command.CommandText = sql;
        foreach (var (name, value) in values) command.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return command;
    }
}
