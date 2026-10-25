using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Data;

// Explicit owner-approved configuration command. Never run from HTTP reads or normal startup.
public static class ApprovedCatalogueSetup
{
    internal static ConsultationService[] Definitions() =>
    [
        Service("Consultas \"Sentir Além do Olhar\"", 120, 50m, "Prepayment"),
        Service("Sessão de Reiki & Alinhamento Energético", 60, 33m, "Prepayment", remotePrice: 16.5m),
        Service("Sessão Individual de Constelação Familiar", 90, null, "Contribution")
    ];

    private static ConsultationService Service(string title, int minutes, decimal? price, string payment, int? pack = null, decimal? remotePrice = null) =>
        new("", title, minutes, price, payment, "InPerson", "Montijo", "",
            BookingOptions: [new("montijo", "InPerson", "Montijo", ""), new("vila-nova", "InPerson", "Vila Nova de São Bento", ""),
                new("online", "Remote", "", "", remotePrice ?? price)],
            Presentation: PublicPresentationContent.ServiceText(title)! with { PackSessions = pack });

    internal static ConsultationService[] Plan(IEnumerable<ConsultationService> current)
    {
        var existing = current.ToArray(); var validation = new ConsultationData(); var additions = new List<ConsultationService>();
        var actor = new ConsultationActor(Guid.Empty.ToString(), Guid.Empty.ToString(), true);
        foreach (var definition in Definitions())
        {
            var matches = existing.Where(s => s.Title.Replace('“', '"').Replace('”', '"') == definition.Title).ToArray();
            if (matches.Length > 1) throw new InvalidOperationException("Duplicate catalogue titles require review. Existing records were not replaced.");
            if (matches.Length == 1)
            {
                var normalized = matches[0] with { Id = "", Version = 1, Title = definition.Title };
                if (JsonSerializer.Serialize(normalized) != JsonSerializer.Serialize(definition))
                    throw new InvalidOperationException("An approved service already has different configuration. No existing service was overwritten.");
                continue;
            }
            ConsultationRules.Apply(validation, new() { Action = "SaveService", OperationId = Guid.NewGuid().ToString(), Service = definition }, actor,
                DateTimeOffset.UtcNow, (_, _, _) => throw new InvalidOperationException("Catalogue setup must not encrypt or change private data."));
            additions.Add(validation.Services[^1]);
        }
        return additions.ToArray();
    }

    public static async Task<int> ApplyAsync(DatabaseConnectionSettings settings, InstallationPaths paths, IDataProtectionProvider provider, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
        await using var gate = new MySqlCommand("SELECT GET_LOCK('pact0.2_db:client-writes',5)", connection);
        if (Convert.ToInt32(await gate.ExecuteScalarAsync(ct)) != 1) throw new InvalidOperationException("Application busy. No catalogue configuration was applied.");
        try
        {
            await using var transaction = await connection.BeginTransactionAsync(ct);
            var rows = new List<string>(); var existing = new List<ConsultationService>();
            await using (var select = new MySqlCommand("SELECT data FROM consultation_services ORDER BY id FOR UPDATE", connection, transaction))
            await using (var reader = await select.ExecuteReaderAsync(ct))
                while (await reader.ReadAsync(ct)) { var raw = reader.GetString(0); rows.Add(raw); existing.Add(JsonSerializer.Deserialize<ConsultationService>(raw)!); }
            var additions = Plan(existing);
            if (additions.Length > 0)
                await SchemaBackup.SaveVerifiedAsync(JsonSerializer.SerializeToUtf8Bytes(rows), "approved-public-catalogue-20261023", paths, provider, ct);
            foreach (var service in additions)
            {
                await using var insert = new MySqlCommand("INSERT INTO consultation_services(id,data) VALUES(@id,@data)", connection, transaction);
                insert.Parameters.AddWithValue("@id", service.Id); insert.Parameters.AddWithValue("@data", JsonSerializer.Serialize(service));
                await insert.ExecuteNonQueryAsync(ct);
            }
            await transaction.CommitAsync(ct); return additions.Length;
        }
        finally
        {
            await using var release = new MySqlCommand("SELECT RELEASE_LOCK('pact0.2_db:client-writes')", connection);
            await release.ExecuteScalarAsync(CancellationToken.None);
        }
    }
}
