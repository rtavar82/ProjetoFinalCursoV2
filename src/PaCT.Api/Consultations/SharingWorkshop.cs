using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public static class SharingWorkshop
{
    public const string Title = "Oficina de dons e talento";
    public const string PreviousTitle = "Grupo de oficina dons da cura";

    public static bool Matches(string title) => title.Trim().Equals(Title, StringComparison.OrdinalIgnoreCase)
        || title.Trim().Equals(PreviousTitle, StringComparison.OrdinalIgnoreCase);

    public static void ValidateService(ConsultationService service)
    {
        if (Matches(service.Title) && (service.ServiceKind != "Group" || service.PaymentMode != "Free"
            || service.ReferencePrice is not (null or 0)))
            throw new IdentityProblem(400, "A oficina de dons e talento é um encontro gratuito de partilha e experiências. Não tem preço nem contribuição livre.");
    }
}
