using PaCT.Api.Consultations;
using PaCT.Api.Identity;
using PaCT.Api.Management;

namespace PaCT.Api.Finance;

public sealed record ExpenseActivity(string Kind, string Id, string Title, DateTimeOffset StartsAt, string? Location);
public sealed record ExpenseActivityPage(int Total, int Page, int PageSize, ExpenseActivity[] Items, string[] Locations);

internal static class ExpenseActivities
{
    internal static readonly string[] Locations = PublicPresentationContent.Places.Select(p => p.Name).ToArray();

    internal static ExpenseActivity? From(Consultation c) => c.Stage == ProcessStage.Request ? null
        : new("Consultation", c.Id, c.Service.Title, c.StartsAt, c.Service.Modality == "Remote" ? "Online" : c.Service.PublicLocation);

    internal static ExpenseActivity? From(GroupEvent e) => e.State == "Cancelled" ? null
        : new("Event", e.Id, e.Service.Title, e.Definition.StartsAt, e.Definition.PublicLocation);

    internal static ExpenseActivityPage Search(ConsultationData data, string kind, string? term, int page)
    {
        if (kind is not ("Consultation" or "Event") || page is < 1 or > 100000 || term?.Length > 200)
            throw new IdentityProblem(400, "Revê a pesquisa de atividades.");
        var query = ManagementDirectory.Normalize(term ?? "");
        var candidates = kind == "Consultation" ? data.Consultations.Select(From) : data.Events.Select(From);
        var matches = candidates.OfType<ExpenseActivity>()
            .Where(item => ManagementDirectory.Normalize(item.Title + " " + item.Location).Contains(query))
            .OrderByDescending(item => item.StartsAt).ThenBy(item => item.Id).ToArray();
        return new(matches.Length, page, 8, matches.Skip((page - 1) * 8).Take(8).ToArray(), Locations);
    }
}
