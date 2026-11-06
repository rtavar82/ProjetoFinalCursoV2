using System.Buffers.Binary;
using System.Security.Cryptography;
using PaCT.Api.Identity;

namespace PaCT.Api.Infrastructure;

public sealed record AudioAttachment(string ContentType, byte[] Bytes)
{
    public const int Limit = 9_000_000;
    public const int RequestLimit = Limit + 65_536;

    public string Hash => Convert.ToHexString(SHA256.HashData(Bytes));
    public static bool IsAudio(string? contentType) => contentType is "audio/mpeg" or "audio/wav" or "audio/ogg";

    public static async Task<AudioAttachment> ReadAsync(IFormFile file, CancellationToken ct)
    {
        if (file.Length is <= 0 or > Limit) throw new IdentityProblem(400, "Escolhe um ficheiro de áudio até 9 MB.");
        using var buffer = new MemoryStream((int)file.Length);
        await file.CopyToAsync(buffer, ct);
        return Validate(buffer.ToArray(), Path.GetExtension(file.FileName));
    }

    internal static AudioAttachment Validate(byte[] bytes, string extension)
    {
        if (bytes.Length is <= 0 or > Limit) throw new IdentityProblem(400, "Escolhe um ficheiro de áudio até 9 MB.");
        var type = extension.ToLowerInvariant() switch
        {
            ".mp3" when IsMp3(bytes) => "audio/mpeg",
            ".wav" when IsWave(bytes) => "audio/wav",
            ".ogg" when IsOgg(bytes) => "audio/ogg",
            _ => throw new IdentityProblem(400, "Escolhe um ficheiro válido em MP3, WAV ou OGG.")
        };
        return new(type, bytes);
    }

    private static bool IsMp3(ReadOnlySpan<byte> data)
    {
        if (data.StartsWith("ID3"u8))
        {
            if (data.Length < 10 || data[3] is < 2 or > 4 || data[6] >= 128 || data[7] >= 128 || data[8] >= 128 || data[9] >= 128) return false;
            var offset = 10 + (data[6] << 21 | data[7] << 14 | data[8] << 7 | data[9]);
            if (data[3] == 4 && (data[5] & 16) != 0) offset += 10;
            if (offset >= data.Length) return false;
            data = data[offset..];
        }
        if (data.Length < 4 || data[0] != 255 || (data[1] & 0xe0) != 0xe0 || (data[1] & 6) != 2) return false;
        var version = (data[1] >> 3) & 3;
        var rate = (data[2] >> 2) & 3;
        var index = data[2] >> 4;
        if (version == 1 || rate == 3 || index is 0 or 15) return false;
        ReadOnlySpan<int> sampleRates = [44100, 48000, 32000];
        ReadOnlySpan<int> mpeg1 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320];
        ReadOnlySpan<int> mpeg2 = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
        var sampleRate = sampleRates[rate] / (version == 3 ? 1 : version == 2 ? 2 : 4);
        return data.Length >= (version == 3 ? 144000 * mpeg1[index] : 72000 * mpeg2[index]) / sampleRate + ((data[2] >> 1) & 1);
    }

    private static bool IsWave(ReadOnlySpan<byte> data)
    {
        if (data.Length < 12 || !data.StartsWith("RIFF"u8) || !data.Slice(8, 4).SequenceEqual("WAVE"u8)) return false;
        var end = 8L + BinaryPrimitives.ReadUInt32LittleEndian(data[4..]);
        if (end > data.Length || end < 12) return false;
        bool format = false, samples = false;
        for (var offset = 12; offset + 8 <= end;)
        {
            var name = data.Slice(offset, 4);
            var size = BinaryPrimitives.ReadUInt32LittleEndian(data[(offset + 4)..]);
            var next = offset + 8L + size + (size & 1);
            if (next > end) return false;
            if (name.SequenceEqual("fmt "u8))
            {
                if (size < 16 || BinaryPrimitives.ReadUInt16LittleEndian(data[(offset + 10)..]) == 0
                    || BinaryPrimitives.ReadUInt32LittleEndian(data[(offset + 12)..]) == 0
                    || BinaryPrimitives.ReadUInt16LittleEndian(data[(offset + 20)..]) == 0) return false;
                format = true;
            }
            if (name.SequenceEqual("data"u8) && size > 0) samples = true;
            offset = (int)next;
        }
        return format && samples;
    }

    private static bool IsOgg(ReadOnlySpan<byte> data)
    {
        if (data.Length < 28 || !data.StartsWith("OggS"u8) || data[4] != 0 || (data[5] & 2) == 0) return false;
        var segments = data[26];
        if (segments == 0 || data.Length < 27 + segments) return false;
        var pageSize = 27 + segments;
        for (var i = 0; i < segments; i++) pageSize += data[27 + i];
        if (pageSize > data.Length) return false;
        var packet = data[(27 + segments)..pageSize];
        return packet.StartsWith("OpusHead"u8) && data[27] >= 19
            || packet.StartsWith("\u0001vorbis"u8) && data[27] >= 30;
    }
}
