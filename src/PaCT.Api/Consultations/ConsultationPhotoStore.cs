using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public sealed record ConsultationPhotoFile(string ConsultationId, string Id, string AuthorId, string ContentType, byte[] Bytes);

public sealed class ConsultationPhotoStore
{
    private readonly IDataProtectionProvider protection;
    private readonly string root;
    public ConsultationPhotoStore(IDataProtectionProvider protection, InstallationPaths paths)
        : this(protection, Path.Combine(paths.Root, "private-consultation-photos")) { }
    internal ConsultationPhotoStore(IDataProtectionProvider protection, string root) { this.protection = protection; this.root = root; }
    private string FilePath(string consultationId, string photoId)
    {
        if (!Guid.TryParse(consultationId, out var consultation) || !Guid.TryParse(photoId, out var photo)) throw new IdentityProblem(400, "A referência da fotografia não é válida.");
        return Path.Combine(root, consultation.ToString("D"), photo.ToString("D") + ".protected");
    }
    private IDataProtector Protector(string consultationId, string photoId) => protection.CreateProtector("PaCT0.2.ConsultationPhoto.v1", consultationId, photoId);

    public async Task SaveAsync(string consultationId, string id, string authorId, byte[] bytes, string contentType, CancellationToken ct)
    {
        ValidateImage(bytes, contentType);
        var target = FilePath(consultationId, id);
        var value = new ConsultationPhotoFile(consultationId, id, authorId, contentType, bytes);
        var protectedBytes = Protector(consultationId, id).Protect(JsonSerializer.SerializeToUtf8Bytes(value));
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        var temporary = target + "." + Guid.NewGuid().ToString("N") + ".partial";
        // Never replace an existing upload; a retry must identify exactly the same bytes.
        try
        {
            await using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, FileOptions.WriteThrough))
            { await file.WriteAsync(protectedBytes, ct); file.Flush(flushToDisk: true); }
            File.Move(temporary, target, overwrite: false);
        }
        catch (IOException) when (File.Exists(target))
        {
            var previous = await ReadAsync(consultationId, id, ct);
            if (previous.AuthorId != authorId || previous.ContentType != contentType || !CryptographicOperations.FixedTimeEquals(SHA256.HashData(previous.Bytes), SHA256.HashData(bytes)))
                throw new IdentityProblem(409, "Esta referência de fotografia já foi utilizada. O original foi preservado.");
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    public async Task<ConsultationPhotoFile> ReadAsync(string consultationId, string id, CancellationToken ct)
    {
        var file = FilePath(consultationId, id);
        if (!File.Exists(file)) throw new IdentityProblem(404, "Fotografia não encontrada.");
        try
        {
            var value = JsonSerializer.Deserialize<ConsultationPhotoFile>(Protector(consultationId, id).Unprotect(await File.ReadAllBytesAsync(file, ct)));
            if (value is null || value.ConsultationId != consultationId || value.Id != id) throw new CryptographicException();
            return value;
        }
        catch (Exception error) when (error is CryptographicException or JsonException) { throw new IdentityProblem(409, "Não foi possível validar a fotografia guardada. O ficheiro foi preservado."); }
    }

    public async Task ValidateClosureAsync(ConsultationCommand command, string authorId, CancellationToken ct)
    {
        if (command.PhotoIds.Length > 20 || command.PhotoIds.Distinct(StringComparer.Ordinal).Count() != command.PhotoIds.Length)
            throw new IdentityProblem(400, "Seleciona até 20 fotografias diferentes.");
        if (command.PhotoIds.Length > 0 && command.Choice != "Performed") throw new IdentityProblem(400, "As fotografias partilhadas exigem uma consulta realizada.");
        foreach (var id in command.PhotoIds)
        {
            var photo = await ReadAsync(command.Id!, id, ct);
            if (photo.AuthorId != authorId) throw new IdentityProblem(403, "Esta fotografia não pertence ao teu fecho.");
        }
    }

    public static void ValidateImage(byte[] bytes, string type)
    {
        if (bytes.Length is 0 or > 4194304) throw new IdentityProblem(400, "Cada fotografia pode ter até 4 MB.");
        int width = 0, height = 0;
        if (type == "image/png" && bytes.Length >= 45 && bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })
            && bytes.AsSpan(12, 4).SequenceEqual("IHDR"u8) && bytes.AsSpan(bytes.Length - 8, 4).SequenceEqual("IEND"u8))
        {
            width = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(16, 4)); height = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(20, 4));
        }
        else if (type == "image/jpeg" && bytes.Length >= 12 && bytes[0] == 255 && bytes[1] == 216 && bytes[^2] == 255 && bytes[^1] == 217)
        {
            var offset = 2;
            while (offset + 4 < bytes.Length)
            {
                if (bytes[offset++] != 255) break;
                while (offset < bytes.Length && bytes[offset] == 255) offset++;
                if (offset >= bytes.Length) break;
                var marker = bytes[offset++];
                if (marker is 217 or 218) break;
                if (marker is 1 or >= 208 and <= 215) continue;
                if (offset + 2 > bytes.Length) break;
                var size = BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(offset, 2));
                if (size < 2 || offset + size > bytes.Length) break;
                if (marker is 192 or 193 or 194 && size >= 8)
                { height = BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(offset + 3, 2)); width = BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(offset + 5, 2)); break; }
                offset += size;
            }
        }
        if (width is <= 0 or > 8000 || height is <= 0 or > 8000 || (long)width * height > 24000000)
            throw new IdentityProblem(400, "Usa fotografias JPEG/PNG válidas, até 8000 píxeis por lado e 24 megapíxeis.");
    }
}
