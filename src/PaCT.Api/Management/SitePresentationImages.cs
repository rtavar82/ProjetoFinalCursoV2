using System.Security.Cryptography;
using System.Text.Json.Nodes;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Management;

public sealed record SiteImageField(string Key, string Label, string Url, string? AltKey, string? CaptionKey);
internal sealed record SiteImageUpload(string Key, string Reference, byte[] Bytes);

public sealed class SitePresentationImages
{
    private sealed record ImageSlot(string Key, string Label, JsonObject Container, string Property,
        string? AltKey = null, string? CaptionKey = null);
    public const int MaximumMegabytes = 5;
    public const int MaximumBytes = MaximumMegabytes * 1024 * 1024;
    public const int RequestLimit = 4 * MaximumBytes + 250000;
    private const string Prefix = "therapist.image.";
    private readonly string root;

    public SitePresentationImages(InstallationPaths paths) : this(Path.Combine(paths.Root, "presentation-images")) { }
    internal SitePresentationImages(string root) => this.root = root;

    private static IEnumerable<ImageSlot> Slots(JsonObject therapist)
    {
        yield return new("portrait", "Fotografia principal", therapist, "heroImage", "therapist.heroAlt");
        var gallery = therapist["gallery"]!.AsArray();
        for (var i = 0; i < gallery.Count; i++)
            yield return new($"gallery-{i + 1}", $"Fotografia {i + 1} da galeria", gallery[i]!.AsObject(), "image",
                $"therapist.gallery.{i}.alt", $"therapist.gallery.{i}.caption");
        yield return new("signature", "Assinatura", therapist, "signatureImage");
    }

    internal static SiteImageField[] Project(SitePublication publication, JsonObject therapist)
    {
        return Slots(therapist).Select(slot =>
        {
            if (publication.Changes.TryGetValue(Prefix + slot.Key, out var reference))
                slot.Container[slot.Property] = $"/api/public/presentation/images/{slot.Key}/{reference}";
            return new SiteImageField(slot.Key, slot.Label, slot.Container[slot.Property]!.GetValue<string>(), slot.AltKey, slot.CaptionKey);
        }).ToArray();
    }

    internal static async Task<SiteImageUpload[]> PrepareAsync(IFormFileCollection files, CancellationToken ct)
    {
        var slots = Slots(SitePresentation.PublicTherapist(SitePresentation.Default)).Select(slot => slot.Key).ToHashSet();
        if (files.Count == 0 || files.Any(file => !slots.Remove(file.Name)))
            throw new IdentityProblem(400, "Escolhe apenas uma imagem por campo da apresentação.");
        var uploads = new List<SiteImageUpload>();
        foreach (var file in files)
        {
            if (file.Length is 0 or > MaximumBytes)
                throw new IdentityProblem(400, $"Cada imagem pode ter até {MaximumMegabytes} MB.");
            using var buffer = new MemoryStream((int)file.Length);
            await file.CopyToAsync(buffer, ct);
            var bytes = buffer.ToArray();
            ConsultationPhotoStore.ValidateImage(bytes, file.ContentType, MaximumMegabytes);
            var extension = file.ContentType == "image/png" ? ".png" : ".jpg";
            uploads.Add(new(file.Name, Convert.ToHexStringLower(SHA256.HashData(bytes)) + extension, bytes));
        }
        return uploads.OrderBy(upload => upload.Key, StringComparer.Ordinal).ToArray();
    }

    internal async Task SaveAsync(SiteImageUpload[] uploads, Dictionary<string, string> changes, CancellationToken ct)
    {
        Directory.CreateDirectory(root);
        foreach (var upload in uploads)
        {
            var target = Path.Combine(root, upload.Reference);
            if (!File.Exists(target))
            {
                var temporary = target + "." + Guid.NewGuid().ToString("N") + ".partial";
                try
                {
                    await File.WriteAllBytesAsync(temporary, upload.Bytes, ct);
                    File.Move(temporary, target, overwrite: false);
                }
                catch (IOException) when (File.Exists(target)) { }
                finally { File.Delete(temporary); }
            }
            changes[Prefix + upload.Key] = upload.Reference;
        }
    }

    internal (string Path, string Type)? PublishedFile(SitePublication publication, string key, string reference)
    {
        if (publication.Changes.GetValueOrDefault(Prefix + key) != reference || reference.Length != 68
            || !reference[..64].All(Uri.IsHexDigit)) return null;
        var type = reference[64..] switch { ".png" => "image/png", ".jpg" => "image/jpeg", _ => null };
        if (type is null) return null;
        var path = Path.Combine(root, reference);
        return File.Exists(path) ? (path, type) : null;
    }
}
