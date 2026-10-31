using System.Text.Json;
using PaCT.Api.Identity;

namespace PaCT.Api.Clients;

public sealed record ClientCommandReceipt(string Id, string? AuthorId, string RequestHash, byte[] Result, DateTime CreatedAt);

public static class ClientCommands
{
    public static string? Key(HttpRequest request)
    {
        var values = request.Headers["Idempotency-Key"];
        if (values.Count == 0) return null;
        if (values.Count != 1 || !Guid.TryParse(values[0], out var id) || id == Guid.Empty)
            throw new IdentityProblem(400, "A identificação deste envio não é válida.");
        return id.ToString("D");
    }

    public static async Task<T> Execute<T>(IClientSession session, IdentitySecurity security, string? id, string? author,
        string kind, object input, DateTime now, Func<Task<T>> apply)
    {
        if (id is null) return await apply();
        var hash = security.CommandHash(kind + ":" + JsonSerializer.Serialize(input));
        if (await session.CommandAsync(id) is { } previous)
        {
            if (previous.AuthorId != author || previous.RequestHash != hash)
                throw new IdentityProblem(409, "Esta identificação já foi usada noutro envio. Revê a operação.");
            return JsonSerializer.Deserialize<T>(security.Decrypt(id, "client-command", previous.Result))!;
        }
        var result = await apply();
        await session.SaveCommandAsync(new(id, author, hash,
            security.Encrypt(id, "client-command", JsonSerializer.Serialize(result)), now));
        return result;
    }
}
