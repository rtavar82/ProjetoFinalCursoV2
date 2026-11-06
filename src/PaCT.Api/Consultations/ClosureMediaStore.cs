using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using PaCT.Api.Identity;
using PaCT.Api.Sharing;

namespace PaCT.Api.Consultations;

public sealed record ClosureMediaReference(string Id, string Kind);

public sealed record ClosureMediaFile(string AuthorId, string Type, string Hash, byte[] Bytes);

public sealed class ClosureMediaStore(IDataProtectionProvider protection, InstallationPaths paths)
{
    internal const string ConversationVideoScope = "message-video";
    internal const int RequestLimit = SharingMedia.VideoLimit + 65_536;

    internal static void ValidateReferences(ConsultationCommand command)
    {
        var shared = command.SharedClosureMedia ?? [];
        var privateMedia = command.PrivateClosureMedia ?? [];
        if ((shared.Length > 0 || privateMedia.Length > 0) && command.Action != "Close")
            throw new IdentityProblem(400, "Os anexos pertencem ao fecho da consulta.");
        if (shared.Length > 0 && command.Choice != "Performed")
            throw new IdentityProblem(400, "A informação partilhada exige uma consulta realizada.");
        ValidateGroup(shared, command.PhotoIds.Length);
        ValidateGroup(privateMedia, 0);
        if (shared.Concat(privateMedia).Select(r => Guid.Parse(r.Id)).Distinct().Count() != shared.Length + privateMedia.Length
            || shared.Concat(privateMedia).Any(r => command.PhotoIds.Contains(r.Id, StringComparer.OrdinalIgnoreCase)))
            throw new IdentityProblem(400, "Usa referências diferentes para cada anexo.");
    }

    private static void ValidateGroup(ClosureMediaReference[] files, int legacyImages)
    {
        if (files.Length > 5 || files.Any(f => f is null || !Guid.TryParseExact(f.Id, "D", out _) || f.Kind is not ("image" or "video" or "audio"))
            || files.Count(f => f.Kind == "image") + legacyImages > 3
            || files.Count(f => f.Kind == "video") > 1 || files.Count(f => f.Kind == "audio") > 1)
            throw new IdentityProblem(400, "Cada secção admite até três imagens, um vídeo e um áudio.");
    }

    internal static ClosureMediaReference? VisibleReference(Consultation c, string scope, string id, ConsultationActor actor)
    {
        if (c.ClosedAt is null || !actor.IsManager && c.PersonId != actor.PersonId) return null;
        return scope switch
        {
            "private" when actor.IsManager => c.PrivateClosureMedia?.SingleOrDefault(r => string.Equals(r.Id, id, StringComparison.OrdinalIgnoreCase)),
            "shared" when c.State == "Performed" => c.SharedClosureMedia?.SingleOrDefault(r => string.Equals(r.Id, id, StringComparison.OrdinalIgnoreCase)),
            _ => null
        };
    }

    internal static string Kind(string contentType) => contentType.Split('/')[0];
    internal static bool ValidScope(string scope) => scope is "private" or "shared";

    private string FilePath(Guid consultationId, string scope, Guid id)
    {
        if (!ValidScope(scope) && scope != ConversationVideoScope) throw new IdentityProblem(404, "Anexo indisponível.");
        return Path.Combine(paths.Root, "consultation-closure-media", consultationId.ToString("D"), scope, id.ToString("D") + ".protected");
    }

    private IDataProtector Protector(Guid consultationId, string scope, Guid id) =>
        protection.CreateProtector("PaCT0.2.ClosureMedia.v1", consultationId.ToString("D"), scope, id.ToString("D"));

    public async Task SaveAsync(Guid consultationId, string scope, Guid id, string authorId, ShareUpload upload, CancellationToken ct)
    {
        var path = FilePath(consultationId, scope, id);
        var data = new ClosureMediaFile(authorId, upload.Media.Type, upload.Media.Hash, upload.Bytes);
        var bytes = Protector(consultationId, scope, id).Protect(JsonSerializer.SerializeToUtf8Bytes(data));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".partial";
        try
        {
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, FileOptions.WriteThrough))
            { await stream.WriteAsync(bytes, ct); stream.Flush(flushToDisk: true); }
            File.Move(temporary, path, overwrite: false);
        }
        catch (IOException) when (File.Exists(path))
        {
            var original = await ReadAsync(consultationId, scope, id, ct);
            if (original.AuthorId != authorId || original.Type != data.Type || original.Hash != data.Hash)
                throw new IdentityProblem(409, "Esta referência de anexo já foi utilizada. O original foi preservado.");
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    public async Task<ClosureMediaFile> ReadAsync(Guid consultationId, string scope, Guid id, CancellationToken ct)
    {
        var path = FilePath(consultationId, scope, id);
        if (!File.Exists(path)) throw new IdentityProblem(404, "Anexo indisponível.");
        try
        {
            var bytes = Protector(consultationId, scope, id).Unprotect(await File.ReadAllBytesAsync(path, ct));
            return JsonSerializer.Deserialize<ClosureMediaFile>(bytes) ?? throw new System.Security.Cryptography.CryptographicException();
        }
        catch (Exception error) when (error is System.Security.Cryptography.CryptographicException or JsonException)
        { throw new IdentityProblem(409, "Não foi possível validar o anexo guardado."); }
    }

    public async Task ValidateMessageVideoAsync(ConsultationCommand command, string authorId, CancellationToken ct)
    {
        if (command.MessageVideoId is null) return;
        if (command.Action != "SendMessage" || !Guid.TryParse(command.Id, out var target)
            || !Guid.TryParseExact(command.MessageVideoId, "D", out var videoId))
            throw new IdentityProblem(400, "O vídeo não corresponde a esta mensagem.");
        var file = await ReadAsync(target, ConversationVideoScope, videoId, ct);
        if (file.AuthorId != authorId || file.Type != "video/mp4")
            throw new IdentityProblem(403, "O vídeo não pertence a este envio.");
    }

    public async Task ValidateUploadAsync(ConsultationCommand command, string authorId, CancellationToken ct)
    {
        ValidateReferences(command);
        if (!Guid.TryParse(command.Id, out var consultationId)) throw new IdentityProblem(400, "Consulta inválida.");
        foreach (var (scope, group) in new[] { ("shared", command.SharedClosureMedia), ("private", command.PrivateClosureMedia) })
        foreach (var reference in group ?? [])
        {
            var file = await ReadAsync(consultationId, scope, Guid.Parse(reference.Id), ct);
            if (file.AuthorId != authorId || Kind(file.Type) != reference.Kind)
                throw new IdentityProblem(403, "O anexo não corresponde a este fecho.");
        }
    }
}
