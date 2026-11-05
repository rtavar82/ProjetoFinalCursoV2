using System.Globalization;
using System.Text;
using PaCT.Api.Identity;

namespace PaCT.Api.Management;

public sealed record DirectoryEntry(string Id, string Kind, string Name, string? TaxId, string? PrivateNotes,
    bool Active, long Version, string AuthorId, DateTimeOffset UpdatedAt, bool Deleted = false);
public sealed record DirectoryChange(string Action, long Version = 0, string? Name = null, string? TaxId = null, string? PrivateNotes = null);
public sealed record DirectoryHistory(string Action, DirectoryEntry Entry);
public sealed record DirectoryPage(int Total, int Page, int PageSize, DirectoryEntry[] Items);
public sealed record DirectoryDetail(DirectoryEntry Entry, int HistoryTotal, int HistoryPage, DirectoryHistory[] History, IReadOnlyDictionary<string, string>? Authors = null);
public sealed record DirectoryResult(bool Confirmed, string Message, DirectoryEntry Entry, bool Duplicate = false);

public interface IManagementStore
{
    Task<DirectoryPage> ListAsync(string kind, string? term, string status, int page, CancellationToken ct);
    Task<DirectoryDetail> DetailAsync(string kind, string id, int historyPage, CancellationToken ct);
    Task<DirectoryResult> ChangeAsync(string kind, string? id, DirectoryChange input, string author, string operationId, CancellationToken ct);
}

public static class ManagementDirectory
{
    public static readonly string[] InitialCategories = ["Material e consumíveis", "Espaços e alugueres", "Deslocações e transportes",
        "Serviços externos", "Software e comunicações", "Divulgação e publicidade", "Equipamento e mobiliário", "Alimentação", "Outros"];
    public static void Kind(string kind)
    {
        if (kind is not ("Supplier" or "ExpenseCategory")) throw new IdentityProblem(404, "Área de gestão não encontrada.");
    }
    public static void Filters(string kind, string? term, string status, int page)
    {
        Kind(kind);
        if (term?.Length > 200 || status is not ("Active" or "Inactive" or "All") || page is < 1 or > 100000)
            throw new IdentityProblem(400, "Confirma os filtros da pesquisa.");
    }
    public static string Normalize(string value) => string.Concat(value.Normalize(NormalizationForm.FormD)
        .Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark && char.IsLetterOrDigit(c))).ToUpperInvariant();
    public static string Identity(DirectoryEntry entry) => Normalize(entry.Kind == "Supplier" ? entry.TaxId! : entry.Name);
    public static string HistoryAction(DirectoryChange input, DirectoryEntry? previous) => previous is null ? "Created" : input.Action switch
    { "Save" => "Updated", "Activate" => "Reactivated", "Deactivate" => "Deactivated", "Delete" => "Deleted", _ => throw new IdentityProblem(400, "Ação inválida.") };
    public static DirectoryEntry Apply(string kind, string id, DirectoryEntry? previous, DirectoryChange input, string author, DateTimeOffset now)
    {
        Kind(kind);
        if (input.Action is not ("Save" or "Activate" or "Deactivate" or "Delete")) throw new IdentityProblem(400, "Ação inválida.");
        if (previous is null && (input.Action != "Save" || input.Version != 0)) throw new IdentityProblem(409, "O registo já não está disponível.");
        if (previous is not null && (previous.Deleted || previous.Kind != kind || input.Version != previous.Version))
            throw new IdentityProblem(409, "O registo mudou. Fecha e volta a abrir antes de confirmar.");
        var current = previous ?? new(id, kind, "", null, null, true, 0, author, now);
        if (input.Action == "Save")
        {
            var name = input.Name?.Trim(); var tax = input.TaxId?.Trim(); var notes = input.PrivateNotes?.Trim();
            if (string.IsNullOrWhiteSpace(name) || name.Length > 200 || name.Any(char.IsControl) || Normalize(name).Length == 0)
                throw new IdentityProblem(400, "Indica o nome ou designação, até 200 caracteres.");
            if (kind == "Supplier" && (string.IsNullOrWhiteSpace(tax) || tax.Length > 64 || tax.Any(char.IsControl) || Normalize(tax).Length < 2))
                throw new IdentityProblem(400, "Indica o NIF ou a identificação fiscal completa, até 64 caracteres.");
            if (notes?.Length > 2000) throw new IdentityProblem(400, "As notas privadas podem ter até 2000 caracteres.");
            if (kind == "ExpenseCategory" && (!string.IsNullOrEmpty(tax) || !string.IsNullOrEmpty(notes)))
                throw new IdentityProblem(400, "A categoria tem apenas nome.");
            current = current with { Name = name, TaxId = kind == "Supplier" ? tax : null, PrivateNotes = string.IsNullOrEmpty(notes) ? null : notes };
        }
        else
        {
            if (input.Name is not null || input.TaxId is not null || input.PrivateNotes is not null)
                throw new IdentityProblem(400, "Esta ação não altera os campos do registo.");
            current = current with { Active = input.Action == "Activate", Deleted = input.Action == "Delete" };
        }
        return current with { Version = current.Version + 1, AuthorId = author, UpdatedAt = now };
    }
    public static DirectoryPage Page(IEnumerable<DirectoryEntry> entries, string kind, string? term, string status, int page)
    {
        Filters(kind, term, status, page); var query = Normalize(term ?? "");
        var rows = entries.Where(e => e.Kind == kind && !e.Deleted && (status == "All" || e.Active == (status == "Active"))
            && (query.Length == 0 || Normalize(e.Name).Contains(query) || e.TaxId is not null && Normalize(e.TaxId).Contains(query)))
            .OrderBy(e => e.Name, StringComparer.Create(CultureInfo.GetCultureInfo("pt-PT"), true)).ThenBy(e => e.Id).ToArray();
        return new(rows.Length, page, 8, rows.Skip((page - 1) * 8).Take(8).ToArray());
    }
}
