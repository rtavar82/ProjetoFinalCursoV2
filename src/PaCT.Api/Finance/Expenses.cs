using System.Text.Json.Serialization;
using PaCT.Api.Identity;
using PaCT.Api.Management;

namespace PaCT.Api.Finance;

public sealed record ExpenseLineInput(string Description, decimal Quantity, decimal UnitPrice, string CategoryId, string Kind,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Vat = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ExpenseAllocationInput[]? Allocations = null);
public sealed record ExpenseLine(string Description, decimal Quantity, decimal UnitPrice, string CategoryId, string CategoryName, string Kind, decimal Total,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Vat = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ExpenseAllocation[]? Allocations = null);
public sealed record ExpenseAllocationInput(decimal Amount, string? ActivityKind = null, string? ActivityId = null, string? Location = null);
public sealed record ExpenseAllocation(decimal Amount, ExpenseActivity? Activity, string? Location);
public sealed record ExpensePaymentInput(decimal Amount, string Method, DateTimeOffset EffectiveAt);
public sealed record ExpensePayment(string Id, decimal Amount, string Method, DateTimeOffset EffectiveAt, string AuthorId, DateTimeOffset RecordedAt);
public sealed record ExpenseDocumentInput(string Name, string Base64);
public sealed record ExpenseDocument(string Id, string Name, string ContentType, int Size);
public sealed record ExpenseChange(string Action, long Version = 0, string? Description = null, DateOnly? Date = null,
    string? SupplierId = null, string? InvoiceNumber = null, DateOnly? InvoiceDate = null, ExpenseLineInput[]? Lines = null,
    ExpensePaymentInput[]? Payments = null, string? Reason = null, ExpenseDocumentInput? Document = null, bool RemoveDocument = false);
public sealed record Expense(string Id, long Version, string Description, DateOnly Date, string? SupplierId, string? SupplierName,
    string? InvoiceNumber, DateOnly? InvoiceDate, ExpenseLine[] Lines, ExpensePayment[] Payments, ExpenseDocument? Document,
    string AuthorId, DateTimeOffset UpdatedAt)
{
    public decimal Total => Lines.Sum(l => l.Total);
    public decimal Paid => Payments.Sum(p => p.Amount);
    public decimal Remaining => Total - Paid;
    public decimal Investments => Lines.Where(l => l.Kind == "Investment").Sum(l => l.Total);
}
public sealed record ExpenseRevision(string Action, string? Reason, Expense Expense);
public sealed record ExpensePage(int Total, int Page, int PageSize, Expense[] Items);
public sealed record ExpenseDetail(Expense Expense, int HistoryTotal, ExpenseRevision[] History, IReadOnlyDictionary<string, string>? Authors = null);
public sealed record ExpenseResult(bool Confirmed, string Message, Expense Expense);
public interface IExpenseStore
{
    Task<ExpensePage> ListAsync(string section, string? term, int page, CancellationToken ct);
    Task<ExpenseDetail> DetailAsync(string id, int historyPage, CancellationToken ct);
    Task<ExpenseResult> ChangeAsync(string? id, ExpenseChange input, string author, string operation, CancellationToken ct);
    Task<(ExpenseDocument Document, byte[] Content)> DocumentAsync(string id, long? version, CancellationToken ct);
}

public static class Expenses
{
    public static readonly string[] Methods = ["Transfer", "Cash", "MbWay", "Card", "Other"];
    private static void Require(bool valid, string message, int status = 400) { if (!valid) throw new IdentityProblem(status, message); }
    private static string Text(string? value, int max, string label)
    {
        var text = value?.Trim() ?? "";
        Require(text.Length > 0 && text.Length <= max && !text.Any(c => char.IsControl(c) && c is not '\n' and not '\r' and not '\t'), "Confirma " + label + ".");
        return text;
    }
    private static bool Money(decimal value) => value >= 0 && value <= 1000000 && decimal.Round(value, 2) == value;
    public static Expense Apply(string id, Expense? previous, ExpenseChange input, DirectoryEntry? supplier,
        IReadOnlyDictionary<string, DirectoryEntry> categories, string author, DateTimeOffset now,
        IReadOnlyDictionary<(string Kind, string Id), ExpenseActivity>? activities = null)
    {
        Require(input.Version == (previous?.Version ?? 0), "Este registo mudou. Fecha o detalhe e volta a abri-lo antes de confirmar.", 409);
        Require(input.Action is "Save" or "Pay", "Operação de despesa inválida.");
        if (input.Action == "Pay")
        {
            Require(previous is not null, "Despesa não encontrada.", 404);
            Require(input.Description is null && input.Lines is null && input.Date is null && input.SupplierId is null
                && input.InvoiceNumber is null && input.InvoiceDate is null && input.Reason is null && input.Document is null && !input.RemoveDocument,
                "O pagamento não altera os dados da despesa.");
            Require(input.Payments is { Length: > 0 }, "Indica o pagamento efetuado.");
            var payments = Payments(input.Payments!, author, now);
            Require(payments.Sum(p => p.Amount) <= previous!.Remaining, "O pagamento excede o valor que falta pagar.");
            return previous with { Version = previous.Version + 1, Payments = [.. previous.Payments, .. payments], AuthorId = author, UpdatedAt = now };
        }
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, PaCT.Api.Consultations.AgendaRules.Lisbon).DateTime);
        Require(input.Date.HasValue && input.Date.Value >= new DateOnly(1900, 1, 1) && input.Date.Value <= today, "Indica a data da despesa, até hoje.");
        Require(input.Lines is { Length: > 0 and <= 100 } && input.Lines.All(l => l is not null), "Acrescenta entre uma e cem linhas à despesa.");
        if (previous?.Lines.Any(line => line.Allocations is { Length: > 0 }) == true)
            Require(input.Lines!.All(line => line.Allocations is not null), "Atualiza a aplicação antes de editar uma despesa com repartições.", 409);
        Require(input.SupplierId is null || supplier is { Kind: "Supplier" } && supplier.Id == input.SupplierId && (supplier.Active || previous?.SupplierId == supplier.Id), "Escolhe um fornecedor ativo.");
        Require(string.IsNullOrWhiteSpace(input.InvoiceNumber) == !input.InvoiceDate.HasValue, "Preenche o número e a data da fatura, ou deixa ambos em branco.");
        Require(!input.InvoiceDate.HasValue || input.InvoiceDate.Value >= new DateOnly(1900, 1, 1) && input.InvoiceDate.Value <= today, "Confirma a data da fatura, até hoje.");
        if (previous is not null) Text(input.Reason, 2000, "o motivo da alteração");
        Require(previous is null || input.Payments is null or { Length: 0 }, "Regista novos pagamentos na ação própria.");
        var lines = input.Lines!.Select(l =>
        {
            Require(l.Quantity > 0 && l.Quantity <= 1000000 && decimal.Round(l.Quantity, 3) == l.Quantity && Money(l.UnitPrice), "Confirma a quantidade e o preço de cada linha.");
            Require(l.Kind is "Expense" or "Investment", "Escolhe Despesa ou Investimento em cada linha.");
            Require(l.CategoryId is not null && categories.TryGetValue(l.CategoryId, out var category) && category.Kind == "ExpenseCategory"
                && (category.Active || previous?.Lines.Any(old => old.CategoryId == l.CategoryId) == true), "Escolhe uma categoria ativa em cada linha.");
            var vatRate = l.Vat switch
            {
                "23" => 23m,
                "6" => 6m,
                "0" or "Included" or null => 0m,
                _ => throw new IdentityProblem(400, "Escolhe uma opção de IVA válida em cada linha.")
            };
            var total = decimal.Round(l.Quantity * l.UnitPrice * (1 + vatRate / 100), 2, MidpointRounding.AwayFromZero);
            Require(Money(total), "O total de uma linha excede o limite permitido.");
            return new ExpenseLine(Text(l.Description, 500, "a descrição da linha"), l.Quantity, l.UnitPrice, l.CategoryId!,
                previous?.Lines.FirstOrDefault(old => old.CategoryId == l.CategoryId)?.CategoryName ?? categories[l.CategoryId!].Name,
                l.Kind, total, l.Vat, Allocate(l.Allocations, total, previous, activities));
        }).ToArray();
        var total = lines.Sum(l => l.Total);
        Require(Money(total) && total > 0, "O total da despesa deve ser superior a zero e não exceder 1 000 000 €.");
        var paid = previous?.Payments ?? Payments(input.Payments ?? [], author, now);
        Require(paid.Sum(p => p.Amount) <= total, "O valor pago excede o total da despesa.");
        return new(id, (previous?.Version ?? 0) + 1, Text(input.Description, 300, "a descrição da despesa"), input.Date!.Value,
            supplier?.Id, supplier?.Id == previous?.SupplierId ? previous?.SupplierName : supplier?.Name,
            string.IsNullOrWhiteSpace(input.InvoiceNumber) ? null : Text(input.InvoiceNumber, 120, "o número da fatura"), input.InvoiceDate,
            lines, paid, input.RemoveDocument ? null : previous?.Document, author, now);
    }
    private static ExpenseAllocation[]? Allocate(ExpenseAllocationInput[]? inputs, decimal lineTotal, Expense? previous,
        IReadOnlyDictionary<(string Kind, string Id), ExpenseActivity>? activities)
    {
        if (inputs is null or { Length: 0 }) return null;
        Require(inputs.Length <= 20 && inputs.All(a => a is not null && Money(a.Amount) && a.Amount > 0),
            "Indica valores positivos, em até vinte repartições por linha.");
        Require(inputs.Sum(a => a.Amount) <= lineTotal, "A repartição excede o total da linha com IVA.");
        var destinations = new HashSet<(string?, string?, string?)>();
        return inputs.Select(a =>
        {
            var location = string.IsNullOrWhiteSpace(a.Location) ? null : a.Location.Trim();
            Require(location is null || ExpenseActivities.Locations.Contains(location), "Escolhe um local válido.");
            ExpenseActivity? activity = null;
            if (a.ActivityKind is not null || a.ActivityId is not null)
            {
                Require(a.ActivityKind is "Consultation" or "Event" && Guid.TryParse(a.ActivityId, out _), "Escolhe uma atividade válida.");
                var activityId = Guid.Parse(a.ActivityId!).ToString("D");
                activity = previous?.Lines.SelectMany(l => l.Allocations ?? []).Select(allocation => allocation.Activity)
                    .OfType<ExpenseActivity>().FirstOrDefault(item => item.Kind == a.ActivityKind && item.Id == activityId)
                    ?? activities?.GetValueOrDefault((a.ActivityKind!, activityId));
                Require(activity is not null, "A atividade já não está disponível. Revê a repartição.", 409);
            }
            Require(activity is not null || location is not null, "Escolhe uma atividade ou um local para cada repartição.");
            Require(destinations.Add((activity?.Kind, activity?.Id, location)), "Junta os valores destinados à mesma atividade e local numa repartição.");
            return new ExpenseAllocation(a.Amount, activity, location);
        }).ToArray();
    }
    private static ExpensePayment[] Payments(ExpensePaymentInput[] input, string author, DateTimeOffset now)
    {
        Require(input.Length <= 20 && input.All(p => p is not null), "Revê os pagamentos indicados.");
        return input.Select(p =>
        {
            Require(Money(p.Amount) && p.Amount > 0, "O valor de cada pagamento deve ser positivo, com até duas casas decimais.");
            Require(Methods.Contains(p.Method), "Escolhe o método de pagamento.");
            Require(p.EffectiveAt >= DateTimeOffset.Parse("1900-01-01T00:00:00Z") && p.EffectiveAt <= now, "Indica a data e hora do pagamento já efetuado.");
            return new ExpensePayment(Guid.NewGuid().ToString(), p.Amount, p.Method, p.EffectiveAt, author, now);
        }).ToArray();
    }
    public static (string Name, string Type, byte[] Content) ValidateDocument(ExpenseDocumentInput input)
    {
        var name = Path.GetFileName(Text(input.Name, 200, "o nome do documento"));
        byte[] bytes;
        try { bytes = Convert.FromBase64String(input.Base64); } catch (Exception e) when (e is FormatException or ArgumentNullException) { throw new IdentityProblem(400, "O documento não é válido."); }
        Require(bytes.Length is > 0 and <= 5242880, "O documento pode ter até 5 MB.");
        var type = bytes.AsSpan().StartsWith("%PDF-"u8) ? "application/pdf" : bytes.AsSpan().StartsWith(new byte[] { 137,80,78,71,13,10,26,10 }) ? "image/png" : bytes.AsSpan().StartsWith(new byte[] { 255,216,255 }) ? "image/jpeg" : "";
        Require(type.Length > 0, "Escolhe um documento PDF ou uma imagem JPEG/PNG.");
        return (name, type, bytes);
    }
}
