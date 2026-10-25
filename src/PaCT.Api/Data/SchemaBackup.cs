using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

internal static class SchemaBackup
{
    internal static async Task SaveVerifiedAsync(byte[] snapshot, string operation, InstallationPaths paths, IDataProtectionProvider provider, CancellationToken ct)
    {
        var protector = provider.CreateProtector("PaCT0.2.SchemaBackup.v1");
        var encrypted = protector.Protect(snapshot);
        var folder = Path.Combine(paths.Root, "data-backups");
        Directory.CreateDirectory(folder);
        var file = Path.Combine(folder, "before-" + operation + "-" + Guid.NewGuid().ToString("N") + ".protected");
        await File.WriteAllBytesAsync(file, encrypted, ct);
        var saved = await File.ReadAllBytesAsync(file, ct);
        if (!SHA256.HashData(encrypted).SequenceEqual(SHA256.HashData(saved))
            || !SHA256.HashData(snapshot).SequenceEqual(SHA256.HashData(protector.Unprotect(saved))))
            throw new InvalidOperationException("The protected backup could not be verified. No schema change was attempted.");
    }
}
