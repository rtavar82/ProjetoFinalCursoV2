using Microsoft.AspNetCore.DataProtection;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;
using System.Security.Cryptography;
using System.Text.Json;

namespace PaCT.Api.Testimonials;

public sealed record TestimonialImage(string PublicationId, string Id, string ContentType, byte[] Bytes);
public sealed class TestimonialImageStore
{
    private readonly IDataProtectionProvider protection;
    private readonly string root;
    public TestimonialImageStore(IDataProtectionProvider protection, InstallationPaths paths)
        : this(protection, Path.Combine(paths.Root, "testimonial-images")) { }
    internal TestimonialImageStore(IDataProtectionProvider protection, string root) { this.protection = protection; this.root = root; }
    private string FilePath(string publicationId, string imageId)
    {
        if (!Guid.TryParseExact(publicationId, "D", out _) || !Guid.TryParseExact(imageId, "D", out _)) throw new IdentityProblem(400, "A referência da imagem não é válida.");
        return Path.Combine(root, publicationId, imageId + ".protected");
    }
    private IDataProtector Protector(string publicationId, string imageId) => protection.CreateProtector("PaCT0.2.TestimonialImage.v1", publicationId, imageId);
    public async Task SaveAsync(TestimonialImage image, CancellationToken ct)
    {
        ConsultationPhotoStore.ValidateImage(image.Bytes, image.ContentType);
        var target = FilePath(image.PublicationId, image.Id); Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        var bytes = Protector(image.PublicationId, image.Id).Protect(JsonSerializer.SerializeToUtf8Bytes(image));
        var temporary = target + "." + Guid.NewGuid().ToString("N") + ".partial";
        try
        {
            await using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, FileOptions.WriteThrough))
            { await file.WriteAsync(bytes, ct); file.Flush(flushToDisk: true); }
            File.Move(temporary, target, overwrite: false);
        }
        catch (IOException) when (File.Exists(target))
        {
            var previous = await ReadAsync(image.PublicationId, image.Id, ct);
            if (previous.ContentType != image.ContentType || !CryptographicOperations.FixedTimeEquals(SHA256.HashData(previous.Bytes), SHA256.HashData(image.Bytes)))
                throw new IdentityProblem(409, "Esta referência de imagem já foi utilizada. O ficheiro anterior foi preservado.");
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public async Task<TestimonialImage> ReadAsync(string publicationId, string imageId, CancellationToken ct)
    {
        var path = FilePath(publicationId, imageId);
        if (!File.Exists(path)) throw new IdentityProblem(404, "Imagem não encontrada.");
        var value = JsonSerializer.Deserialize<TestimonialImage>(Protector(publicationId, imageId).Unprotect(await File.ReadAllBytesAsync(path, ct)));
        if (value?.PublicationId != publicationId || value.Id != imageId) throw new InvalidOperationException("Inconsistent testimonial image.");
        return value;
    }
}
