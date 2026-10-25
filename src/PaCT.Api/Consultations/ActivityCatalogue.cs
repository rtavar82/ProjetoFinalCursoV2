namespace PaCT.Api.Consultations;

// Approved activity types exist independently of dated occurrences. Reading this catalogue never writes data.
public static class ActivityCatalogue
{
    public static ConsultationService[] Types() =>
    [
        new("638cdb3e-f15b-4da0-908e-df2ea4f4e771", "Grupo de constelação", 0, null, "Prepayment", "InPerson", "", "", ServiceKind: "Group", DefinedPerEvent: true),
        new("638cdb3e-f15b-4da0-908e-df2ea4f4e772", SharingWorkshop.Title, 0, 0, "Free", "InPerson", "", "", ServiceKind: "Group", DefinedPerEvent: true),
        new("638cdb3e-f15b-4da0-908e-df2ea4f4e773", "Retiro", 0, null, "Prepayment", "InPerson", "", "", ServiceKind: "Retreat", DefinedPerEvent: true)
    ];

    public static bool IsBuiltIn(string id) => Types().Any(type => type.Id == id);

    public static ConsultationService[] Complete(IEnumerable<ConsultationService> services)
    {
        var result = services.ToList();
        foreach (var type in Types())
            if (!result.Any(service => service.Id == type.Id || service.ServiceKind == type.ServiceKind
                && (string.Equals(service.Title.Trim(), type.Title, StringComparison.OrdinalIgnoreCase)
                    || SharingWorkshop.Matches(type.Title) && SharingWorkshop.Matches(service.Title)))) result.Add(type);
        return result.ToArray();
    }
}
