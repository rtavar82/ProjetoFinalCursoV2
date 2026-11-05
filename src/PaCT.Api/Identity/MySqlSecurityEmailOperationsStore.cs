using MySql.Data.MySqlClient;

namespace PaCT.Api.Identity;

public sealed partial class MySqlIdentityStore
{
    public async Task<SecurityEmailQueueSnapshot> ReadEmailQueueAsync(CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        await using (var command = Command(connection, "SELECT state, COUNT(*) FROM security_emails GROUP BY state"))
        await using (var reader = (MySqlDataReader)await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct)) counts[reader.GetString(0)] = Convert.ToInt32(reader.GetInt64(1));
        }

        var uncertain = new List<SecurityEmailQueueItem>();
        try
        {
            await using var command = Command(connection, "SELECT e.id,e.state,e.created_at,e.attempted_at,e.updated_at,COUNT(r.operation_id) AS review_count FROM security_emails e LEFT JOIN security_email_reviews r ON r.email_id=e.id WHERE e.state='Uncertain' GROUP BY e.id,e.state,e.created_at,e.attempted_at,e.updated_at ORDER BY e.updated_at, e.id LIMIT 100");
            await using var reader = (MySqlDataReader)await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                uncertain.Add(new(Identifier(reader, "id"), reader.GetString(reader.GetOrdinal("state")), reader.GetDateTime(reader.GetOrdinal("created_at")),
                    Date(reader, "attempted_at"), reader.GetDateTime(reader.GetOrdinal("updated_at")), Convert.ToInt32(reader["review_count"])));
        }
        catch (MySqlException error) when (error.Number == 1146)
        {
            await using var command = Command(connection, "SELECT id,state,created_at,attempted_at,updated_at FROM security_emails WHERE state='Uncertain' ORDER BY updated_at, id LIMIT 100");
            await using var reader = (MySqlDataReader)await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                uncertain.Add(new(Identifier(reader, "id"), reader.GetString(reader.GetOrdinal("state")), reader.GetDateTime(reader.GetOrdinal("created_at")),
                    Date(reader, "attempted_at"), reader.GetDateTime(reader.GetOrdinal("updated_at")), 0));
        }

        return new(
            Count(counts, "Pending"), Count(counts, "Sending"), Count(counts, "Submitted"),
            Count(counts, "Failed"), Count(counts, "Uncertain"), Count(counts, "Cancelled"), uncertain);
    }

    public async Task<SecurityEmailReviewReceipt> RecordReviewAsync(string emailId, string operationId, string managerAccountId, DateTime now, CancellationToken ct)
    {
        if (!Guid.TryParse(emailId, out var emailGuid) || !Guid.TryParse(operationId, out var operationGuid) || !Guid.TryParse(managerAccountId, out var managerGuid))
            throw new IdentityProblem(400, "A identificação da revisão não é válida.");

        await using var connection = await OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        try
        {
            await using (var previous = Command(connection, "SELECT email_id FROM security_email_reviews WHERE operation_id=@operation FOR UPDATE", transaction, ("@operation", operationGuid.ToString("D"))))
            {
                var value = await previous.ExecuteScalarAsync(ct);
                if (value is not null)
                {
                    var previousEmail = value is Guid guid ? guid.ToString("D") : Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture);
                    if (!string.Equals(previousEmail, emailGuid.ToString("D"), StringComparison.OrdinalIgnoreCase))
                        throw new IdentityProblem(409, "Esta identificação já foi usada noutra revisão. Revê a operação.");
                    await transaction.CommitAsync(ct);
                    return new(emailGuid.ToString("D"), operationGuid.ToString("D"), true);
                }
            }

            await using (var state = Command(connection, "SELECT state FROM security_emails WHERE id=@id FOR UPDATE", transaction, ("@id", emailGuid.ToString("D"))))
            {
                var current = Convert.ToString(await state.ExecuteScalarAsync(ct), System.Globalization.CultureInfo.InvariantCulture);
                if (current is null) throw new IdentityProblem(404, "O registo de envio já não está disponível para revisão.");
                if (current != "Uncertain") throw new IdentityProblem(409, "Este registo de envio já não está no estado incerto para revisão.");
            }

            await using (var insert = Command(connection, "INSERT INTO security_email_reviews(operation_id,email_id,manager_account_id,action,created_at) VALUES(@operation,@email,@manager,'Review',@now)",
                transaction, ("@operation", operationGuid.ToString("D")), ("@email", emailGuid.ToString("D")), ("@manager", managerGuid.ToString("D")), ("@now", now)))
                await insert.ExecuteNonQueryAsync(ct);
            await transaction.CommitAsync(ct);
            return new(emailGuid.ToString("D"), operationGuid.ToString("D"), false);
        }
        catch (MySqlException error) when (error.Number == 1146)
        {
            throw new IdentityProblem(503, "A revisão administrativa de envios ainda não está preparada nesta instalação.");
        }
        catch (MySqlException error) when (error.Number == 1062)
        {
            throw new IdentityProblem(409, "Esta revisão já está a ser processada. Atualiza o estado antes de repetir.");
        }
    }

    private static int Count(IReadOnlyDictionary<string, int> counts, string state) => counts.GetValueOrDefault(state);
}
