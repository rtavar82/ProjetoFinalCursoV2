using System.Security.Cryptography;
using System.Text.Json;
using PaCT.Api.Identity;

namespace PaCT.Api.Testimonials;

// Editorial content only: deliberately no person, client, consultation or event reference.
public sealed record Testimonial(string Id, string Text, string? ImageId, bool Published, long Version,
    string CreatedBy, string UpdatedBy, DateTime CreatedAt, DateTime UpdatedAt, string OperationId, string RequestHash);
public sealed record TestimonialChange(string Id, long Version, string OperationId, string Text, bool Published, bool RemoveImage);

public interface ITestimonialStore
{
    Task<IReadOnlyList<Testimonial>> ReadAsync(bool publishedOnly, CancellationToken ct);
    Task<Testimonial?> FindAsync(string id, CancellationToken ct);
    Task<Testimonial> ChangeAsync(string id, Func<Testimonial?, Task<Testimonial>> change, CancellationToken ct);
}

public static class TestimonialRules
{
    public const int MaxTextLength = 10000;
    public static string Hash(TestimonialChange change, byte[]? image) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
    { change.Id, change.Version, change.OperationId, change.Text, change.Published, change.RemoveImage, image = image is null ? null : Convert.ToHexString(SHA256.HashData(image)) })));

    public static Testimonial Apply(Testimonial? current, TestimonialChange change, bool hasImage, string hash, string author, DateTime now)
    {
        if (!Guid.TryParseExact(change.Id, "D", out _) || !Guid.TryParseExact(change.OperationId, "D", out _))
            throw new IdentityProblem(400, "A referência da publicação não é válida.");
        if (current?.OperationId == change.OperationId)
        {
            if (current.RequestHash != hash || current.UpdatedBy != author) throw new IdentityProblem(409, "Esta operação já foi usada com outros dados. A publicação anterior foi preservada.");
            return current;
        }
        if (change.Version < 0 || (current?.Version ?? 0) != change.Version)
            throw new IdentityProblem(409, "A publicação mudou entretanto. Atualiza e revê antes de guardar.");
        if (change.Text.Length > MaxTextLength) throw new IdentityProblem(400, "O texto pode ter até 10000 caracteres.");
        if (hasImage && change.RemoveImage) throw new IdentityProblem(400, "Escolhe entre substituir ou retirar a imagem.");
        var imageId = hasImage ? change.OperationId : change.RemoveImage ? null : current?.ImageId;
        var text = change.Text.Trim();
        if (text.Length == 0 && imageId is null) throw new IdentityProblem(400, "Acrescenta texto, uma imagem ou ambos.");
        return new(change.Id, text, imageId, change.Published, checked((current?.Version ?? 0) + 1),
            current?.CreatedBy ?? author, author, current?.CreatedAt ?? now, now, change.OperationId, hash);
    }
}
