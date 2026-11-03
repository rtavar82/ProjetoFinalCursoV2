namespace PaCT.Api.Consultations;

// Event and enrolment states are independent of the individual consultation stages.
public static class EventLifecycle
{
    public static bool RegistrationOpen(GroupEvent e, DateTimeOffset now) => e.State == "Waiting"
        && e.Definition.Published && now < e.Definition.StartsAt;

    public static GroupEvent At(GroupEvent e, DateTimeOffset now) => e.State == "Waiting" && now >= e.Definition.StartsAt
        ? e with { State = "AwaitingClosure" } : e;

    public static EventParticipation At(GroupEvent e, EventParticipation p, DateTimeOffset now) =>
        p.State is "Requested" or "Waiting" && now >= e.Definition.StartsAt ? p with { State = "Expired", Version = p.Version + 1,
            History = [..p.History ?? [], new("ExpiredAtStart", "System", e.Definition.StartsAt)] } : p;

    public static string Substate(GroupEvent e, EventParticipation p, DateTimeOffset now)
    {
        p = At(e, p, now);
        if (p.State is "Requested" or "Waiting" or "Rejected" or "Expired" or "Cancelled") return p.State;
        if (e.State == "Cancelled") return "Cancelled";
        return p.Attendance ?? (now >= e.Definition.StartsAt ? "AwaitingClosure" : "Confirmed");
    }

    public static ProcessStatus Status(GroupEvent e, DateTimeOffset now)
    {
        var state = At(e, now).State;
        var label = state switch { "Waiting" => "Em espera", "AwaitingClosure" => "Por fechar", "Performed" => "Realizada",
            "Cancelled" when e.CancellationReason == "MinimumParticipants" => "Cancelada por falta de participantes mínimos",
            "Cancelled" => "Cancelada pela gestão", _ => throw new InvalidOperationException("Estado de evento inválido.") };
        return new("Event", e.Service.ServiceKind == "Retreat" ? "Retiro" : "Grupo", label, label);
    }

    public static ProcessStatus Status(GroupEvent e, EventParticipation p, DateTimeOffset now)
    {
        var state = Substate(e, p, now);
        var label = state switch {
            "Requested" => "aguarda validação", "Waiting" => "em espera", "Rejected" => "recusado", "Expired" => "expirado",
            "Confirmed" when p.RequiresClientAcceptance && p.AcceptedAt is null => "confirmada · Condições por aceitar",
            "Confirmed" => "confirmada", "AwaitingClosure" => "por fechar", "Performed" => "compareceu", "NoShow" => "não compareceu", "Withdrawn" => "desistiu durante o retiro",
            "Cancelled" when p.CancellationBy == "MinimumParticipants" || e.CancellationReason == "MinimumParticipants" => "cancelada por falta de participantes mínimos",
            "Cancelled" when p.CancellationBy == "Participant" => "cancelada pelo participante",
            "Cancelled" => "cancelada pela gestão", _ => throw new InvalidOperationException("Estado de inscrição inválido.") };
        var kind = state is "Requested" or "Waiting" or "Rejected" or "Expired" ? "Pedido de inscrição"
            : state is "Performed" or "NoShow" or "Withdrawn" or "AwaitingClosure" ? "Participação" : "Inscrição";
        return new("Participation", kind, label, kind + " — " + label);
    }
}
