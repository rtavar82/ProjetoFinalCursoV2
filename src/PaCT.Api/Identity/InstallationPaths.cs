namespace PaCT.Api.Identity;

public sealed class InstallationPaths(IConfiguration configuration, IHostEnvironment environment)
{
    public string Id { get; } = ResolveId(configuration, environment);
    public string Root => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PaCT", "installations", Id, "security");

    private static string ResolveId(IConfiguration configuration, IHostEnvironment environment)
    {
        if (Guid.TryParse(configuration["Installation:Id"], out var id)) return id.ToString();
        if (environment.IsDevelopment()) return "pact-v02-development";
        throw new InvalidOperationException("Configure a unique Installation:Id before deploying this installation. Do not reuse another buyer's identifier or keys.");
    }
}
