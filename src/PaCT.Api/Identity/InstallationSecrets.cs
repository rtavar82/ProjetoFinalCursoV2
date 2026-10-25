using Microsoft.AspNetCore.DataProtection;
using System.Security.Cryptography;
using System.Text.Json;

namespace PaCT.Api.Identity;

public interface IInstallationSecrets
{
    bool IsPrepared { get; }
    byte[] SearchKey { get; }
    bool VerifyInstallationCode(string value);
}

public sealed record InstallationSecretValues(string SetupCode, byte[] SearchKey);

public sealed class InstallationSecrets(IDataProtectionProvider provider, IConfiguration configuration, InstallationPaths paths) : IInstallationSecrets
{
    private string SecretPath => Path.Combine(paths.Root, "installation.protected");
    private readonly IDataProtector protector = provider.CreateProtector("PaCT0.2.Installation.v1");

    private InstallationSecretValues Read()
    {
        if (!File.Exists(SecretPath)) throw new IdentityProblem(503, "Falta preparar esta instalação. Consulta as instruções de configuração inicial.");
        try
        {
            return JsonSerializer.Deserialize<InstallationSecretValues>(protector.Unprotect(File.ReadAllBytes(SecretPath)))
                ?? throw new CryptographicException();
        }
        catch (Exception error) when (error is CryptographicException or JsonException)
        {
            throw new IdentityProblem(503, "Não foi possível abrir as chaves desta instalação. Não cries novas chaves por cima das existentes.");
        }
    }

    public bool IsPrepared => File.Exists(SecretPath);
    public byte[] SearchKey => Read().SearchKey;
    public bool VerifyInstallationCode(string value) => value.Length <= 256 && CryptographicOperations.FixedTimeEquals(
        SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(value)),
        SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(Read().SetupCode)));

    public void Prepare()
    {
        if (IsPrepared) { _ = Read(); return; }
        Directory.CreateDirectory(paths.Root);
        var values = new InstallationSecretValues(Convert.ToHexString(RandomNumberGenerator.GetBytes(24)), RandomNumberGenerator.GetBytes(32));
        using var file = new FileStream(SecretPath, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        file.Write(protector.Protect(JsonSerializer.SerializeToUtf8Bytes(values)));
    }

    public string GetSetupCode() => Read().SetupCode;
    public string PublicWebUrl
    {
        get
        {
            if (!Uri.TryCreate(configuration["Application:WebUrl"], UriKind.Absolute, out var uri)
                || uri.Scheme != "https" || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment)
                || !string.IsNullOrEmpty(uri.Query))
                throw new IdentityProblem(503, "Configura Application:WebUrl com o endereço HTTPS desta instalação, sem parâmetros.");
            return uri.AbsoluteUri.TrimEnd('/');
        }
    }
}
