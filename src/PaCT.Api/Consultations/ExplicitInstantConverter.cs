using System.Text.Json;
using System.Text.Json.Serialization;

namespace PaCT.Api.Consultations;

// Date/time inputs are instants. A wall-clock value without an offset must not inherit the host timezone.
public sealed class ExplicitInstantConverter : JsonConverter<DateTimeOffset>
{
    public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.String) throw new JsonException("Indica a data e hora com UTC ou indicativo de fuso.");
        var text = reader.GetString()!;
        var hasOffset = text.EndsWith('Z') || text.Length >= 6 && text[^6] is '+' or '-' && text[^3] == ':';
        if (!hasOffset || !reader.TryGetDateTimeOffset(out var value)) throw new JsonException("Indica a data e hora com UTC ou indicativo de fuso.");
        return value;
    }
    // Preserve the serializer's original date representation and existing idempotency hashes.
    public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options) => writer.WriteStringValue(value);
}

public sealed class OptionalExplicitInstantConverter : JsonConverter<DateTimeOffset?>
{
    public override DateTimeOffset? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType == JsonTokenType.Null ? null : new ExplicitInstantConverter().Read(ref reader, typeof(DateTimeOffset), options);
    public override void Write(Utf8JsonWriter writer, DateTimeOffset? value, JsonSerializerOptions options)
    { if (value is null) writer.WriteNullValue(); else writer.WriteStringValue(value.Value); }
}
