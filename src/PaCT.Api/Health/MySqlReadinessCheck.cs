using Microsoft.Extensions.Diagnostics.HealthChecks;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;

namespace PaCT.Api.Health;

public sealed class MySqlReadinessCheck(DatabaseConnectionSettings settings) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        if (!settings.IsConfigured)
            return HealthCheckResult.Unhealthy("A ligação MySQL ainda não está configurada.");

        try
        {
            await using var connection = settings.CreateConnection();
            await connection.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT DATABASE()";
            var database = await command.ExecuteScalarAsync(cancellationToken) as string;

            return string.Equals(database, DatabaseConnectionSettings.ExpectedDatabaseName, StringComparison.Ordinal)
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy("Não foi confirmada a base autorizada.");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception error) when (error is MySqlException or TimeoutException or OperationCanceledException or InvalidOperationException)
        {
            // Never include connector exceptions, credentials or server details in health responses.
            return HealthCheckResult.Unhealthy("Não foi possível confirmar a ligação MySQL.");
        }
    }
}

