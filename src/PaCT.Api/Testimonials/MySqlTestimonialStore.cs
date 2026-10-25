using System.Text.Json;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Testimonials;

public sealed class MySqlTestimonialStore(DatabaseConnectionSettings settings, IdentitySecurity security) : ITestimonialStore
{
    private static IdentityProblem NotPrepared() => new(503, "A área de testemunhos ainda não está preparada. Os dados existentes não foram alterados.");
    private Testimonial Decode(System.Data.Common.DbDataReader reader)
    {
        var id = Convert.ToString(reader["id"])!;
        var value = JsonSerializer.Deserialize<Testimonial>(security.Decrypt(id, "testimonial", (byte[])reader["data"]))
            ?? throw new InvalidOperationException("Invalid testimonial record.");
        if (value.Id != id || value.Published != Convert.ToBoolean(reader["is_published"]) || value.Version != Convert.ToInt64(reader["version"]))
            throw new InvalidOperationException("Inconsistent testimonial record.");
        return value;
    }
    public async Task<IReadOnlyList<Testimonial>> ReadAsync(bool publishedOnly, CancellationToken ct)
    {
        try
        {
            await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
            await using var command = new MySqlCommand("SELECT id,is_published,version,data FROM testimonials" + (publishedOnly ? " WHERE is_published=1" : ""), connection);
            await using var reader = await command.ExecuteReaderAsync(ct); var rows = new List<Testimonial>();
            while (await reader.ReadAsync(ct)) rows.Add(Decode(reader));
            return rows.OrderByDescending(row => row.CreatedAt).ThenBy(row => row.Id, StringComparer.Ordinal).ToArray();
        }
        catch (MySqlException error) when (error.Number == 1146) { throw NotPrepared(); }
    }
    public async Task<Testimonial?> FindAsync(string id, CancellationToken ct)
    {
        try
        {
            await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
            await using var command = new MySqlCommand("SELECT id,is_published,version,data FROM testimonials WHERE id=@id", connection);
            command.Parameters.AddWithValue("@id", id); await using var reader = await command.ExecuteReaderAsync(ct);
            return await reader.ReadAsync(ct) ? Decode(reader) : null;
        }
        catch (MySqlException error) when (error.Number == 1146) { throw NotPrepared(); }
    }
    public async Task<Testimonial> ChangeAsync(string id, Func<Testimonial?, Task<Testimonial>> change, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
        await using var gate = new MySqlCommand("SELECT GET_LOCK('pact0.2_db:testimonial-writes',5)", connection);
        if (Convert.ToInt32(await gate.ExecuteScalarAsync(ct)) != 1) throw new IdentityProblem(409, "Há outra alteração de testemunhos em curso. Volta a tentar dentro de instantes.");
        try
        {
            await using var transaction = await connection.BeginTransactionAsync(ct);
            Testimonial? current;
            await using (var read = new MySqlCommand("SELECT id,is_published,version,data FROM testimonials WHERE id=@id FOR UPDATE", connection, transaction))
            {
                read.Parameters.AddWithValue("@id", id); await using var reader = await read.ExecuteReaderAsync(ct);
                current = await reader.ReadAsync(ct) ? Decode(reader) : null;
            }
            var result = await change(current);
            if (result != current)
            {
                await using var command = new MySqlCommand(current is null
                    ? "INSERT INTO testimonials(id,is_published,version,data) VALUES(@id,@published,@version,@data)"
                    : "UPDATE testimonials SET is_published=@published,version=@version,data=@data WHERE id=@id AND version=@previous", connection, transaction);
                command.Parameters.AddWithValue("@id", result.Id); command.Parameters.AddWithValue("@published", result.Published);
                command.Parameters.AddWithValue("@version", result.Version); command.Parameters.AddWithValue("@previous", current?.Version ?? 0);
                command.Parameters.AddWithValue("@data", security.Encrypt(result.Id, "testimonial", JsonSerializer.Serialize(result)));
                if (await command.ExecuteNonQueryAsync(ct) != 1) throw new IdentityProblem(409, "A publicação mudou. Atualiza antes de guardar.");
            }
            await transaction.CommitAsync(ct); return result;
        }
        catch (MySqlException error) when (error.Number == 1146) { throw NotPrepared(); }
        finally
        {
            await using var release = new MySqlCommand("SELECT RELEASE_LOCK('pact0.2_db:testimonial-writes')", connection);
            await release.ExecuteScalarAsync(CancellationToken.None);
        }
    }
}
