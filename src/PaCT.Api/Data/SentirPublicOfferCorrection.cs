using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

// Explicit correction of the existing public service only. Never called at application startup.
public static class SentirPublicOfferCorrection
{
    internal static ConsultationService? Plan(ConsultationService current)
    {
        if (!PublicExperienceContent.IsSentir(current.Title)) throw new InvalidOperationException("This correction only applies to Sentir Além do Olhar.");
        var candidate = current with
        {
            ReferencePrice = 55m,
            PaymentMode = "Prepayment",
            BookingOptions = current.BookingOptions?.Select(option => option with {
                ReferencePrice = option.ReferencePrice is null ? null : 55m,
                PaymentMode = option.PaymentMode is null ? null : "Prepayment"
            }).ToArray(),
            Presentation = (current.Presentation ?? PublicPresentationContent.ServiceText(current.Title)!) with { PackSessions = null }
        };
        if (JsonSerializer.Serialize(candidate) == JsonSerializer.Serialize(current)) return null;
        return candidate with { Version = checked(current.Version + 1) };
    }

    public static async Task<int> ApplyAsync(DatabaseConnectionSettings settings, InstallationPaths paths, IDataProtectionProvider provider, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
        await using var gate = new MySqlCommand("SELECT GET_LOCK('pact0.2_db:client-writes',5)", connection);
        if (Convert.ToInt32(await gate.ExecuteScalarAsync(ct)) != 1) throw new InvalidOperationException("Application busy. The catalogue was not changed.");
        try
        {
            await using var transaction = await connection.BeginTransactionAsync(ct);
            var matches = new List<ConsultationService>();
            await using (var read = new MySqlCommand("SELECT data FROM consultation_services ORDER BY id FOR UPDATE", connection, transaction))
            await using (var reader = await read.ExecuteReaderAsync(ct))
                while (await reader.ReadAsync(ct))
                {
                    var service = JsonSerializer.Deserialize<ConsultationService>(reader.GetString(0)) ?? throw new InvalidOperationException("Invalid catalogue record.");
                    if (PublicExperienceContent.IsSentir(service.Title)) matches.Add(service);
                }
            if (matches.Count != 1) throw new InvalidOperationException("Exactly one existing Sentir Além do Olhar service is required. No catalogue entry was changed.");
            var current = matches[0]; var updated = Plan(current);
            if (updated is null) { await transaction.CommitAsync(ct); return 0; }
            await SchemaBackup.SaveVerifiedAsync(JsonSerializer.SerializeToUtf8Bytes(current), "sentir-public-offer-20261024", paths, provider, ct);
            await using var write = new MySqlCommand("UPDATE consultation_services SET data=@data WHERE id=@id AND COALESCE(JSON_EXTRACT(data,'$.Version'),1)=@version", connection, transaction);
            write.Parameters.AddWithValue("@id", current.Id); write.Parameters.AddWithValue("@version", current.Version);
            write.Parameters.AddWithValue("@data", JsonSerializer.Serialize(updated));
            if (await write.ExecuteNonQueryAsync(ct) != 1) throw new InvalidOperationException("The service changed. The correction was not confirmed.");
            await transaction.CommitAsync(ct); return 1;
        }
        finally
        {
            await using var release = new MySqlCommand("SELECT RELEASE_LOCK('pact0.2_db:client-writes')", connection);
            await release.ExecuteScalarAsync(CancellationToken.None);
        }
    }
}
