using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;
using PaCT.Api.Infrastructure;

namespace PaCT.Api.Sharing;

public sealed class SharingMedia(IConfiguration configuration, InstallationPaths paths, SharingStore store)
{
    public const int VideoLimit = 25 * 1000 * 1000;
    public const int ImageLimit = 4 * 1024 * 1024;
    public const int RequestLimit = VideoLimit + 5 * ImageLimit + AudioAttachment.Limit + 65536;

    private readonly SemaphoreSlim videoGate = new(1);
    private readonly SemaphoreSlim posterGate = new(1);

    private string Executable(string name, string key)
    {
        var local = Path.Combine(Path.GetDirectoryName(paths.Root)!, "tools", OperatingSystem.IsWindows() ? name + ".exe" : name);
        return configuration[key] ?? (File.Exists(local) ? local : name);
    }

    public async Task<ShareUpload> ReadAsync(IFormFile file, CancellationToken ct)
    {
        if (file.Name == "audio")
        {
            var audio = await AudioAttachment.ReadAsync(file, ct);
            return new(new(Guid.NewGuid().ToString(), audio.ContentType, audio.Hash), audio.Bytes);
        }
        var video = file.Name == "video";
        if (file.Length <= 0 || file.Length > (video ? VideoLimit : ImageLimit))
            throw new IdentityProblem(400, video ? "O vídeo pode ter até 25 MB." : "Cada imagem pode ter até 4 MB.");
        using var buffer = new MemoryStream((int)file.Length);
        await file.CopyToAsync(buffer, ct);
        var original = buffer.ToArray();
        var hash = Convert.ToHexString(SHA256.HashData(original));
        if (video)
        {
            if (original.Length < 16 || !original.AsSpan(4, 4).SequenceEqual("ftyp"u8))
                throw new IdentityProblem(400, "Escolhe um vídeo MP4 ou MOV.");
            if (!await videoGate.WaitAsync(0, ct))
                throw new IdentityProblem(409, "Há outro vídeo a ser preparado. Tenta novamente dentro de instantes.");
            try { return new(new(Guid.NewGuid().ToString(), "video/mp4", hash), await ConvertVideoAsync(original, ct)); }
            finally { videoGate.Release(); }
        }
        ConsultationPhotoStore.ValidateImage(original, file.ContentType);
        return new(new(Guid.NewGuid().ToString(), file.ContentType, hash), original);
    }

    public async Task<byte[]?> GetPosterAsync(string postId, string videoId, CancellationToken ct)
    {
        var cached = await store.ReadMediaAsync(postId, videoId, ct, poster: true);
        if (cached is not null) return cached;
        await posterGate.WaitAsync(ct);
        try
        {
            cached = await store.ReadMediaAsync(postId, videoId, ct, poster: true);
            if (cached is not null) return cached;
            var video = await store.ReadMediaAsync(postId, videoId, ct);
            if (video is null) return null;
            var poster = await ExtractPosterAsync(video, ct);
            await store.SavePosterAsync(postId, videoId, poster, ct);
            return poster;
        }
        finally { posterGate.Release(); }
    }

    private async Task<byte[]> ExtractPosterAsync(byte[] video, CancellationToken ct)
    {
        var directory = Directory.CreateTempSubdirectory("pact-sharing-poster-").FullName;
        var source = Path.Combine(directory, "video.mp4");
        var output = Path.Combine(directory, "poster.jpg");
        try
        {
            await File.WriteAllBytesAsync(source, video, ct);
            await RunAsync(Executable("ffmpeg", "Sharing:FFmpegPath"),
                ["-nostdin", "-v", "error", "-protocol_whitelist", "file", "-f", "mov", "-threads", "2", "-max_pixels", "16777216", "-i", source,
                 "-map", "0:v:0", "-an", "-map_metadata", "-1", "-filter_threads", "1",
                 "-vf", "thumbnail=24,scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2",
                 "-frames:v", "1", "-c:v", "mjpeg", "-q:v", "4", "-threads", "1", "-f", "image2", "-update", "1", output], ct);
            return await File.ReadAllBytesAsync(output, ct);
        }
        finally
        {
            File.Delete(source);
            File.Delete(output);
            Directory.Delete(directory);
        }
    }

    private async Task<byte[]> ConvertVideoAsync(byte[] input, CancellationToken ct)
    {
        var directory = Directory.CreateTempSubdirectory("pact-sharing-").FullName;
        var source = Path.Combine(directory, "source.mov");
        var output = Path.Combine(directory, "video.mp4");
        try
        {
            await File.WriteAllBytesAsync(source, input, ct);
            var duration = await RunAsync(Executable("ffprobe", "Sharing:FFprobePath"),
                ["-v", "error", "-protocol_whitelist", "file", "-f", "mov", "-i", source,
                 "-show_entries", "format=duration", "-of", "default=nw=1:nk=1"], ct);
            if (!double.TryParse(duration.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds)
                || !double.IsFinite(seconds) || seconds <= 0 || seconds > 30)
                throw new IdentityProblem(400, "Escolhe um vídeo com uma duração máxima de 30 segundos.");
            await RunAsync(Executable("ffmpeg", "Sharing:FFmpegPath"),
                ["-nostdin", "-v", "error", "-protocol_whitelist", "file", "-f", "mov", "-threads", "2", "-max_pixels", "16777216", "-i", source,
                 "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", "-map_chapters", "-1", "-filter_threads", "1",
                 "-vf", "scale=720:720:force_original_aspect_ratio=decrease:force_divisible_by=2", "-r", "30", "-t", "30",
                 "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-threads", "2", "-c:a", "aac",
                 "-movflags", "+faststart", "-fs", VideoLimit.ToString(CultureInfo.InvariantCulture), output], ct);
            var result = new FileInfo(output);
            if (!result.Exists || result.Length == 0 || result.Length >= VideoLimit)
                throw new IdentityProblem(400, "Não foi possível preparar o vídeo para reprodução.");
            return await File.ReadAllBytesAsync(output, ct);
        }
        finally
        {
            File.Delete(source);
            File.Delete(output);
            Directory.Delete(directory);
        }
    }

    private static async Task<string> RunAsync(string executable, string[] arguments, CancellationToken ct)
    {
        var start = new ProcessStartInfo(executable) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = new Process { StartInfo = start };
        try { process.Start(); }
        catch (System.ComponentModel.Win32Exception)
        {
            throw new IdentityProblem(503, "O processamento de vídeo ainda não está configurado.");
        }
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(50));
        try
        {
            var output = process.StandardOutput.ReadToEndAsync(deadline.Token);
            var error = process.StandardError.ReadToEndAsync(deadline.Token);
            await process.WaitForExitAsync(deadline.Token);
            await error;
            if (process.ExitCode != 0) throw new IdentityProblem(400, "Não foi possível ler o vídeo. Confirma se o ficheiro é válido.");
            return await output;
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new IdentityProblem(400, "O vídeo demorou demasiado tempo a processar. Experimenta um vídeo mais curto.");
        }
        finally { if (!process.HasExited) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(CancellationToken.None); } }
    }
}