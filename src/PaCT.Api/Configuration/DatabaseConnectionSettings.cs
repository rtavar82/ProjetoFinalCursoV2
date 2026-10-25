using MySql.Data.MySqlClient;

namespace PaCT.Api.Configuration;

public sealed class DatabaseConnectionSettings
{
    public const string ConnectionName = "PaCT0.2Db";
    public const string ExpectedDatabaseName = "pact0.2_db";
    private readonly string? connectionString;

    private DatabaseConnectionSettings(string? connectionString)
    {
        this.connectionString = connectionString;
    }

    public bool IsConfigured => connectionString is not null;

    public static DatabaseConnectionSettings FromConfiguration(IConfiguration configuration)
    {
        var value = configuration.GetConnectionString(ConnectionName);
        if (string.IsNullOrWhiteSpace(value))
            return new(null);

        MySqlConnectionStringBuilder parsed;
        try
        {
            parsed = new(value);
        }
        catch (Exception error) when (error is ArgumentException or FormatException or OverflowException)
        {
            throw new InvalidOperationException("A ligação MySQL não tem um formato válido. Revê ConnectionStrings:PaCT0.2Db nos segredos deste projeto.");
        }

        if (!string.Equals(parsed.Database, ExpectedDatabaseName, StringComparison.Ordinal))
            throw new InvalidOperationException("A ligação foi recusada: este projeto só pode usar a base pact0.2_db. A base anterior não será utilizada.");

        if (string.IsNullOrWhiteSpace(parsed.Server) || string.IsNullOrWhiteSpace(parsed.UserID))
            throw new InvalidOperationException("Indica servidor e utilizador MySQL nos segredos deste projeto.");

        parsed.PersistSecurityInfo = false;
        parsed.Logging = false;
        parsed.UseUsageAdvisor = false;
        parsed.ConnectionTimeout = 5;
        parsed.DefaultCommandTimeout = 5;
        return new(parsed.ConnectionString);
    }

    public MySqlConnection CreateConnection()
    {
        if (connectionString is null)
            throw new InvalidOperationException("A ligação MySQL ainda não está configurada.");

        return new(connectionString);
    }
}

