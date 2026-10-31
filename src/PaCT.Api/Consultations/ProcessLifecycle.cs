using System.Text.Json.Serialization;

namespace PaCT.Api.Consultations;

[JsonConverter(typeof(JsonStringEnumConverter<ProcessStage>))]
public enum ProcessStage { Request, Booking, Consultation }
public sealed record ProcessStageChange(ProcessStage From, ProcessStage To, DateTimeOffset At, string? AuthorId);
public sealed record ProcessStatus(ProcessStage Stage, string StageLabel, string StateLabel, string ProcessLabel);

// One transition rule for persisted principal states, shared by commands, clock and reads.
public static class ProcessLifecycle
{
    public static string StageLabel(ProcessStage stage) => stage switch
    {
        ProcessStage.Request => "Pedido de marcação", ProcessStage.Booking => "Marcação", ProcessStage.Consultation => "Consulta",
        _ => throw new InvalidOperationException("Unknown process stage.")
    };

    public static ProcessStatus Describe(ProcessStage stage, string state, string? origin = null, string? financial = null)
    {
        var label = state switch
        {
            "Requested" or "InTreatment" => "aguarda validação",
            "Confirmed" when stage == ProcessStage.Consultation => "por fechar",
            "Confirmed" when financial == "AwaitingReceipt" => "confirmada - aguarda recebimento",
            "Confirmed" => "confirmada", "Scheduled" when stage == ProcessStage.Consultation => "por fechar",
            "Scheduled" => "confirmada", "AwaitingClosure" => "por fechar", "Performed" => "realizada", "NoShow" => "não compareceu",
            "Rejected" when origin is "Client" or "Participant" => "cancelado pelo cliente",
            "Rejected" => "não validado", "Expired" => "expirado", "Waiting" => "em espera", "Linked" => "validado",
            "CancelledClient" => "cancelada pelo cliente", "CancelledManager" => "cancelada pela gestão",
            "Cancelled" when stage == ProcessStage.Request && origin is "Client" or "Participant" => "cancelado pelo cliente",
            "Cancelled" when stage == ProcessStage.Request => "cancelado pela gestão",
            "Cancelled" when origin is "Client" or "Participant" => "cancelada pelo cliente",
            "Cancelled" => "cancelada pela gestão", _ => throw new InvalidOperationException("Unknown process substate.")
        };
        return new(stage, StageLabel(stage), label, StageLabel(stage) + " — " + label);
    }
    public static ProcessStatus Status(Consultation c, DateTimeOffset now) => Describe(At(c, now).Stage, Substate(c, now), c.CancellationOrigin, ConsultationRules.FinancialState(c));
    public static ProcessStatus Status(GuestConsultationRequest g, DateTimeOffset now) => Describe(g.Stage, Substate(g, now), g.CancellationOrigin);
    public static ProcessStatus Status(GroupEvent e, DateTimeOffset now) => Describe(At(e, now).Stage, Substate(e, now));
    public static ProcessStatus Status(GroupEvent e, EventParticipation p, DateTimeOffset now) => Describe(At(e, p, now).Stage,
        p.State == "Cancelled" && p.Stage == ProcessStage.Request && p.CancellationBy == "Rejected" ? "Rejected" : Substate(e, p, now), p.CancellationBy,
        p.ExpectationOpen ? "AwaitingReceipt" : null);

    public static Consultation At(Consultation c, DateTimeOffset now)
    {
        if (c.Stage == ProcessStage.Request && c.State == "Requested" && now >= c.StartsAt)
            return c with { State = "Expired", Version = c.Version + 1 };
        if (c.Stage == ProcessStage.Booking && c.State == "Confirmed" && now >= c.StartsAt)
            return c with { Stage = ProcessStage.Consultation,
                StageHistory = [..c.StageHistory, new(c.Stage, ProcessStage.Consultation, c.StartsAt, null)] };
        return c;
    }
    public static GuestConsultationRequest At(GuestConsultationRequest g, DateTimeOffset now) =>
        g.Stage == ProcessStage.Request && g.State is "Requested" or "InTreatment" && now >= g.StartsAt
            ? g with { State = "Expired", Version = g.Version + 1 } : g;
    public static GroupEvent At(GroupEvent e, DateTimeOffset now) =>
        e.Stage == ProcessStage.Booking && e.State == "Scheduled" && now >= e.Definition.StartsAt
            ? e with { Stage = ProcessStage.Consultation, StageHistory = [..e.StageHistory ?? [], new(e.Stage, ProcessStage.Consultation, e.Definition.StartsAt, null)] } : e;
    public static EventParticipation At(GroupEvent e, EventParticipation p, DateTimeOffset now)
    {
        if (p.Stage == ProcessStage.Request && p.State == "Requested" && now >= e.Definition.StartsAt)
            return p with { State = "Expired", Version = p.Version + 1 };
        if (p.Stage == ProcessStage.Booking && p.State == "Confirmed" && now >= e.Definition.StartsAt)
            return p with { Stage = ProcessStage.Consultation, StageHistory = [..p.StageHistory ?? [], new(p.Stage, ProcessStage.Consultation, e.Definition.StartsAt, null)] };
        return p;
    }
    public static string Substate(Consultation c, DateTimeOffset now)
    {
        var current = At(c, now);
        return current.Stage == ProcessStage.Consultation && current.State == "Confirmed" ? "AwaitingClosure" : current.State;
    }
    public static string Substate(GuestConsultationRequest g, DateTimeOffset now) => At(g, now).State;
    public static string Substate(GroupEvent e, EventParticipation p, DateTimeOffset now)
    {
        var current = At(e, p, now);
        return current.State == "Cancelled" || e.State == "Cancelled" ? "Cancelled"
            : current.State == "Confirmed" && current.Attendance is "Performed" or "NoShow" ? current.Attendance
            : current.Stage == ProcessStage.Consultation && current.State == "Confirmed" ? "AwaitingClosure" : current.State;
    }
    public static string Substate(GroupEvent e, DateTimeOffset now) => At(e, now) is { Stage: ProcessStage.Consultation, State: "Scheduled" } ? "AwaitingClosure" : e.State;

    public static void Advance(ConsultationData data, DateTimeOffset now)
    {
        for (var i = 0; i < data.Consultations.Count; i++) data.Consultations[i] = At(data.Consultations[i], now);
        for (var i = 0; i < data.GuestRequests.Count; i++) data.GuestRequests[i] = At(data.GuestRequests[i], now);
        for (var i = 0; i < data.Events.Count; i++) data.Events[i] = At(data.Events[i], now);
        var events = data.Events.ToDictionary(e => e.Id);
        for (var i = 0; i < data.Participations.Count; i++)
        {
            var p = data.Participations[i]; data.Participations[i] = At(events[p.EventId], p, now);
        }
    }

    public static void Validate(object value)
    {
        var valid = value switch
        {
            Consultation c => c.Stage switch {
                ProcessStage.Request => c.State is "Requested" or "Rejected" or "Expired",
                ProcessStage.Booking => c.State is "Confirmed" or "CancelledClient" or "CancelledManager",
                ProcessStage.Consultation => c.State is "Confirmed" or "Performed" or "NoShow" or "CancelledClient" or "CancelledManager", _ => false },
            GuestConsultationRequest g => g.Stage == ProcessStage.Request && g.State is "Requested" or "InTreatment" or "Expired" or "Rejected" or "Linked",
            GroupEvent e => e.Stage is ProcessStage.Booking or ProcessStage.Consultation && (e.State is "Scheduled" or "Cancelled" || e.State == "Performed" && e.Stage == ProcessStage.Consultation),
            EventParticipation p => p.Stage switch {
                ProcessStage.Request => p.State is "Requested" or "Waiting" or "Rejected" or "Expired" or "Cancelled",
                ProcessStage.Booking => p.State is "Confirmed" or "Cancelled" && p.Attendance is null,
                ProcessStage.Consultation => p.State is "Confirmed" or "Cancelled", _ => false },
            _ => true
        };
        if (!valid) throw new InvalidOperationException("Inconsistent principal state and substate. The write was refused.");
    }
}
