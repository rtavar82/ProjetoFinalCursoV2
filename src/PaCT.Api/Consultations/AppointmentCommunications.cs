using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public static class AppointmentCommunications
{
    public const string OnlineCare = "Escolhe um local calmo e privado, garante uma ligação estável à internet e verifica a câmara e o microfone antes da consulta. A videochamada será por WhatsApp ou Google Meet, conforme combinado com a terapeuta.";
    public static string Instructions(string modality, string location, string configured) => !string.IsNullOrWhiteSpace(configured) ? configured : modality == "Remote" ? OnlineCare : location.Trim() switch
    {
        "Montijo" => "Praça da Liberdade n.º 77, 2870-015 Montijo",
        "Vila Nova de São Bento" => "R. Brg. Tiago Pedro Martins n.º 32, Vila Nova de São Bento, Alentejo",
        _ => ""
    };
    public static string? EmailKind(ConsultationNotice notice, Consultation c, DateTimeOffset now)
    {
        if (notice.Cancelled || notice.ExpiresAt <= now || notice.DueAt > now || notice.PersonId != c.PersonId) return null;
        if (notice.Kind == "Approved" && c.State == "Confirmed" && c.StartsAt > now)
            return c.FinancialChoice == "Prepayment" ? "PrepaymentApproval" : "BookingConfirmation";
        if (notice.Kind == "Reminder26" && c.State == "Confirmed" && c.StartsAt > now) return "AppointmentReminder";
        return c.State == "Performed" && (notice.Kind == "Closed" || notice.Kind.StartsWith("SharedReport:", StringComparison.Ordinal)) ? "AppointmentSharedInformation" : null;
    }
    public static AppointmentEmailSummary Summary(ConsultationService service, DateTimeOffset start, DateTimeOffset end, string? location = null, string? mode = null) =>
        new(service.Title, start, end, location ?? service.PublicLocation, mode ?? service.PaymentMode, service.ReferencePrice,
            Instructions(service.Modality, location ?? service.PublicLocation, service.Instructions));
    public static bool NeedsInstructions(string kind) => kind != "PrepaymentApproval";
}
