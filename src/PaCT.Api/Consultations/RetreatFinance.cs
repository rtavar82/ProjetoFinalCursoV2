using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public static class RetreatFinance
{
    private static void Require(bool ok, string message, int status = 409) { if (!ok) throw new IdentityProblem(status, message); }
    private static bool Money(decimal amount) => amount > 0 && amount <= 1000000m && decimal.Round(amount, 2) == amount;
    public static decimal Price(GroupEvent e) => e.Definition.TotalPrice ?? e.Service.ReferencePrice ?? 0;
    public static decimal Applied(ConsultationData data, EventParticipation p) => ParticipationCredit.Applied(data, p);
    public static decimal Remaining(ConsultationData data, EventParticipation p) => ParticipationCredit.Remaining(data, data.Events.Single(e => e.Id == p.EventId), p);
    public static decimal Returned(EventParticipation p) => (p.Returns ?? []).Sum(r => r.Amount);
    public static bool CanReceive(ConsultationData data, EventParticipation p) => GroupPaymentConditions.CanReceive(data, data.Events.Single(e => e.Id == p.EventId), p);
    public static void ValidateDefinition(EventInput input, ConsultationService service)
    {
        Require(Money(input.TotalPrice ?? service.ReferencePrice ?? 0), "Indica o preço único do retiro.", 400);
        IdentityValidation.Required(input.Program, 8000, "o programa completo do retiro");
        IdentityValidation.Required(input.CancellationConditions, 8000, "as condições de cancelamento do retiro");
    }
}
