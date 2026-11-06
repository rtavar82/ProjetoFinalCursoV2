using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Management;

public sealed record SitePlace(string Name, string Description, string Address);

public static class SiteLocations
{
    private const string Prefix = "place.";
    private const string AddressSuffix = ".address";
    public const string Online = "Online";

    private static string Key(string name, string field) => Prefix + name + "." + field;
    public static bool Removed(SitePublication site, string name) => site.Changes.ContainsKey(Key(name, "removed"));
    public static string Address(SitePublication site, string name) => site.Text(Key(name, "address"), "");

    private static IEnumerable<string> KnownNames(SitePublication site) => site.Changes.Keys
        .Where(key => key.StartsWith(Prefix, StringComparison.Ordinal) && key.EndsWith(AddressSuffix, StringComparison.Ordinal))
        .Select(key => key[Prefix.Length..^AddressSuffix.Length]);

    public static SitePlace[] Published(SitePublication site) => KnownNames(site)
        .Where(name => !Removed(site, name))
        .Select(name => new SitePlace(name, SitePresentation.LocationDescription(site, "InPerson", name), Address(site, name)))
        .OrderBy(place => place.Name, StringComparer.OrdinalIgnoreCase).ToArray();

    public static string[] PhysicalNames(ConsultationData data, SitePublication? publication = null)
    {
        var site = publication ?? data.PublishedSite;
        return Published(site).Select(place => place.Name)
        .Concat(data.Services.Where(service => service.Active).SelectMany(ClientBooking.Options)
            .Where(option => option.Modality == "InPerson" && !string.IsNullOrWhiteSpace(option.PublicLocation))
            .Select(option => option.PublicLocation))
        .Where(name => !Removed(site, name)).Distinct(StringComparer.Ordinal)
        .Order(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    internal static void Apply(SitePublication site, SitePlace[]? input, Dictionary<string, string> changes)
    {
        if (input is null || input.Length > 50) throw new IdentityProblem(400, "Revê a lista de locais. São permitidos até 50 locais.");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { Online };
        var usedNames = KnownNames(site).ToDictionary(name => name, StringComparer.OrdinalIgnoreCase);
        foreach (var place in input)
        {
            if (place is null) throw new IdentityProblem(400, "Revê os dados do local.");
            var name = IdentityValidation.Required(place.Name, 120, "o nome do local");
            if (!names.Add(name)) throw new IdentityProblem(400, "Já existe um local com esse nome.");
            if (usedNames.TryGetValue(name, out var previous) && (name != previous || Removed(site, previous)))
                throw new IdentityProblem(409, "Este nome já foi utilizado. Escolhe um nome diferente para o novo local.");
            changes[Key(name, "address")] = IdentityValidation.Required(place.Address, 500, "a morada completa");
            var description = place.Description?.Trim().ReplaceLineEndings("\n") ?? "";
            if (description.Length is 0 or > 600 || description.Any(c => char.IsControl(c) && c != '\n'))
                throw new IdentityProblem(400, "Preenche a descrição pública do local, até 600 caracteres.");
            changes[Key(name, "description")] = description;
        }
        foreach (var previous in Published(site).Where(place => !names.Contains(place.Name)))
        {
            changes[Key(previous.Name, "address")] = previous.Address;
            changes[Key(previous.Name, "removed")] = "true";
        }
    }
}
