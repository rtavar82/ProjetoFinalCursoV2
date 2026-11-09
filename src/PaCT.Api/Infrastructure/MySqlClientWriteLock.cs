using MySql.Data.MySqlClient;

namespace PaCT.Api.Infrastructure;

internal static class MySqlClientWriteLock
{
    public static async Task<bool> TryAcquireAsync(MySqlConnection connection, CancellationToken ct)
    {
        // Let the server's five-second wait finish before the connector times out.
        await using var command = new MySqlCommand("SELECT GET_LOCK('pact0.2_db:client-writes',5)", connection)
        {
            CommandTimeout = 7
        };
        return Convert.ToInt32(await command.ExecuteScalarAsync(ct)) == 1;
    }

    public static async Task ReleaseAsync(MySqlConnection connection)
    {
        await using var command = new MySqlCommand("SELECT RELEASE_LOCK('pact0.2_db:client-writes')", connection);
        await command.ExecuteScalarAsync(CancellationToken.None);
    }
}

