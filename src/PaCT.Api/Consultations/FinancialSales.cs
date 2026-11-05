using System.Text.Json;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public sealed record SaleLineInput(string Kind, string Name, int Quantity, decimal UnitPrice,
    string? Description = null, string? Weight = null, string? Size = null, int? Sessions = null,
    string[]? ServiceIds = null, string? Modality = null, string? Location = null,
    [property: JsonConverter(typeof(OptionalExplicitInstantConverter))] DateTimeOffset? StartsAt = null,
    [property: JsonConverter(typeof(OptionalExplicitInstantConverter))] DateTimeOffset? EndsAt = null,
    decimal? RegularTotal = null);
public sealed record SalePayment(string Method, decimal Amount);
public sealed record SaleInput(string? PersonId, bool Anonymous,
    [property: JsonConverter(typeof(ExplicitInstantConverter))] DateTimeOffset EffectiveAt,
    SaleLineInput[] Lines, SalePayment[] Payments);
public sealed record FinancialSale(string Id, string? PersonId, string CreatedBy, DateTimeOffset CreatedAt,
    DateTimeOffset EffectiveAt, decimal Total, string[] Kinds, string LinesCiphertext, SalePayment[] Payments, string[] PackIds);

public static class FinancialSales
{
    public static readonly string[] Kinds = ["Product", "Pack", "Training", "CompletedConsultation", "Service"];
    public static readonly string[] Methods = ["Transfer", "Cash", "MbWay", "Card", "Other"];
    private static void Require([DoesNotReturnIf(false)] bool condition, string message, int status = 400)
    { if (!condition) throw new IdentityProblem(status, message); }
    private static bool Money(decimal value) => value > 0 && value <= 1000000 && decimal.Round(value, 2) == value;
    private static string? Optional(string? value, int limit)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        Require(value.Trim().Length <= limit, "Um dos textos da venda excede o tamanho permitido.");
        return value.Trim();
    }

    public static SaleLineInput[] Validate(ConsultationData data, SaleInput input, DateTimeOffset now)
    {
        Require(data.SalesReady, "O registo de vendas ainda não está disponível. A preparação da base de dados deve ser concluída.", 503);
        Require(input.Anonymous ? input.PersonId is null : Guid.TryParse(input.PersonId, out _), "Seleciona uma ficha ou escolhe venda anónima.");
        Require(input.EffectiveAt > DateTimeOffset.UnixEpoch && input.EffectiveAt <= now, "Indica a data e hora em que o dinheiro foi recebido, sem datas futuras.");
        Require(input.Lines is { Length: > 0 and <= 20 }, "Acrescenta entre uma e vinte linhas à venda.");
        Require(input.Payments is { Length: > 0 and <= 5 }, "Indica pelo menos um método de recebimento.");
        Require(input.Payments.All(p => p is not null && Methods.Contains(p.Method) && Money(p.Amount))
            && input.Payments.Select(p => p.Method).Distinct().Count() == input.Payments.Length,
            "Indica um montante positivo por método, sem repetir métodos de recebimento.");
        var services = ActivityCatalogue.Complete(data.Services).ToArray();
        var lines = input.Lines.Select(line =>
        {
            Require(line is not null && Kinds.Contains(line.Kind), "Seleciona o tipo de cada linha.");
            Require(line!.Quantity is >= 1 and <= 1000 && Money(line.UnitPrice), "Indica quantidade inteira e preço unitário positivo, com até duas casas decimais.");
            var normalized = line with
            {
                Name = IdentityValidation.Required(line.Name, 200, "o nome ou descrição da linha"),
                Description = Optional(line.Description, 1000), Weight = Optional(line.Weight, 100), Size = Optional(line.Size, 100),
                Location = Optional(line.Location, 200)
            };
            if (line.Kind == "Pack")
            {
                Require(!input.Anonymous, "Um pack precisa de uma ficha titular, mesmo que a pessoa não tenha conta.");
                Require(line.Sessions is >= 1 and <= 1000, "Indica o número de sessões de cada pack.");
                Require(line.RegularTotal is > 0 && Money(line.RegularTotal.Value) && line.UnitPrice < line.RegularTotal,
                    "Indica o valor das mesmas sessões avulso. O valor final do pack deve ser inferior.");
                Require(line.ServiceIds is { Length: > 0 and <= 20 } && line.ServiceIds.Distinct().Count() == line.ServiceIds.Length
                    && line.ServiceIds.All(id => services.Any(s => s.Id == id && s.Active && s.ServiceKind != "Retreat" && s.PaymentMode != "Free" && !SharingWorkshop.Matches(s.Title))),
                    "Seleciona os serviços pagos abrangidos pelo pack; retiros e atividades gratuitas não são elegíveis.");
            }
            else Require(line.Sessions is null && line.RegularTotal is null, "As sessões e a comparação avulso pertencem apenas às linhas de pack.");
            if (line.Kind == "CompletedConsultation")
            {
                Require(line.ServiceIds is { Length: 1 } && services.Any(s => s.Id == line.ServiceIds[0] && s.Active), "Seleciona o tipo da consulta já realizada.");
                Require(line.StartsAt > DateTimeOffset.UnixEpoch && line.EndsAt > line.StartsAt && line.EndsAt <= now,
                    "Indica início e fim já ocorridos, com o fim posterior ao início.");
                Require(line.Modality is "InPerson" or "Remote", "Escolhe a modalidade da consulta realizada.");
                Require(line.Modality == "Remote" || normalized.Location is "Montijo" or "Vila Nova de São Bento", "Escolhe o local da consulta realizada.");
                if (line.Modality == "Remote") normalized = normalized with { Location = null };
            }
            else Require(line.StartsAt is null && line.EndsAt is null && line.Modality is null && line.Location is null,
                "Horário, modalidade e local pertencem à linha de consulta já realizada.");
            if (line.Kind is not ("Pack" or "CompletedConsultation"))
                Require(line.ServiceIds is null or { Length: 0 }, "Esta linha usa uma descrição livre, sem associação a um serviço da Agenda.");
            Require(line.Kind == "Product" || line.Weight is null && line.Size is null, "Peso e tamanho pertencem apenas às linhas de produto.");
            return normalized;
        }).ToArray();
        var total = lines.Sum(l => l.Quantity * l.UnitPrice);
        Require(Money(total), "O total da venda deve ser positivo e não pode ultrapassar 1 000 000 €.");
        Require(input.Payments.Sum(p => p.Amount) == total, "A soma dos recebimentos tem de ser igual ao total da venda. Só são registadas vendas integralmente pagas.");
        return lines;
    }

    public static ConsultationResult Apply(ConsultationData data, ConsultationCommand command, ConsultationActor actor,
        DateTimeOffset now, Func<string, string, string, string> encrypt)
    {
        Require(actor.IsManager, "Esta operação exige um gestor.", 403);
        var input = command.Sale ?? throw new IdentityProblem(400, "Preenche a venda.");
        var lines = Validate(data, input, now);
        var id = Guid.NewGuid().ToString();
        var packs = new List<string>();
        foreach (var line in lines.Where(l => l.Kind == "Pack"))
            for (var unit = 0; unit < line.Quantity; unit++)
            {
                var pack = SessionPacks.CreatePaidSalePack(data, input.PersonId!, line, input.EffectiveAt, actor, id);
                packs.Add(pack.Id);
            }
        data.Sales.Add(new(id, input.Anonymous ? null : input.PersonId, actor.AccountId, now, input.EffectiveAt.ToUniversalTime(),
            lines.Sum(l => l.Quantity * l.UnitPrice), lines.Select(l => l.Kind).Distinct().ToArray(),
            encrypt(id, "sale-lines", JsonSerializer.Serialize(lines)), input.Payments, packs.ToArray()));
        return new(id, "Venda e recebimento registados.", command.OperationId);
    }
}
