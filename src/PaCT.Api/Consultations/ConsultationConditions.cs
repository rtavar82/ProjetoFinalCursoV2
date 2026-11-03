using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public sealed record ConditionSection(string Title, string[] Paragraphs, string[] Bullets);
public sealed record ConsultationConditionSet(string Version, string Mode, string Label, string AcceptLabel,
    ConditionSection[] Sections, object? PaymentInformation)
{
    public string Text => string.Join("\n\n", Sections.Select(section => string.Join("\n", new[] { section.Title }.Concat(section.Paragraphs).Concat(section.Bullets))));
}

public static class ConsultationConditions
{
    public static bool AcceptAtRequest(string mode) => mode is "Postpayment" or "Contribution";
    public static string VersionForMode(string mode) => mode == "Prepayment" ? ConsultationRules.TermsVersion : ConsultationRules.TermsVersion + ":" + mode;
    public static ConsultationConditionSet? ForRequest(ConsultationService service) => service.ServiceKind is null && AcceptAtRequest(service.PaymentMode)
        ? DescribeMode(service.PaymentMode, VersionForMode(service.PaymentMode)) : null;
    public static void ValidateRequest(ConsultationService service, bool accepted, string? version)
    {
        var conditions = ForRequest(service);
        if (conditions is not null && (!accepted || version != conditions.Version))
            throw new IdentityProblem(400, "Abre e aceita as condições e a forma de pagamento antes de enviar o pedido.");
        if (conditions is null && (accepted || version is not null))
            throw new IdentityProblem(400, "A aceitação destas condições não pertence ao pedido de marcação.");
    }
    public static string Mode(Consultation c) => c.FinancialChoice == "Prepayment" && c.AdvanceSatisfiedAt is not null
        ? "Credit" : c.FinancialChoice ?? c.Service.PaymentMode;
    public static string Version(Consultation c) => VersionForMode(Mode(c));
    public static bool HasClientAccount(ConsultationData data, string personId) => data.ClientAccountPeople.Contains(personId)
        || data.ClientReadOwners.Values.Contains(personId, StringComparer.Ordinal);
    public static bool Pending(Consultation c, DateTimeOffset now) => c.RequiresClientAcceptance && c.AcceptedAt is null && ProcessLifecycle.Substate(c, now) == "Confirmed";
    public static ConsultationConditionSet Describe(Consultation c)
    {
        var mode = Mode(c);
        return DescribeMode(mode, Version(c));
    }
    public static ConsultationConditionSet DescribeMode(string mode, string version)
    {
        var payable = mode is "Prepayment" or "Postpayment" or "Contribution";
        var label = mode switch { "Prepayment" => "Pagamento antecipado", "Postpayment" => "Pagamento depois da consulta",
            "Contribution" => "Contribuição livre, paga depois da consulta", "Credit" => "Crédito disponível na conta",
            "Gift" => "Oferta do pagamento", _ => "Sem pagamento necessário" };
        string[] paragraphs = mode switch
        {
            "Prepayment" => [],
            "Contribution" => [PublicPresentationContent.ContributionDescription, PublicPresentationContent.ContributionTiming],
            "Postpayment" => ["O pagamento é feito depois da consulta."],
            "Gift" => ["Esta consulta foi oferecida pela terapeuta. Não tens pagamento a efetuar por esta consulta."],
            "Credit" => ["Os valores recebidos ficam em crédito na tua conta. Aceitar as condições não desconta saldo. O pagamento desta marcação exige uma liquidação confirmada, consultável no histórico de pagamentos."],
            _ => ["Esta consulta é gratuita. Não tens pagamento a efetuar por esta consulta."]
        };
        var sections = new List<ConditionSection> {
            new(mode == "Contribution" ? "Contribuição livre e consciente" : "Condições da consulta", paragraphs,
                mode == "Prepayment" ? PublicPresentationContent.PrepaymentConditions : [])
        };
        sections.Add(new("Cancelamentos ou faltas", [], mode is "Free" or "Gift" ? [
            "Podes cancelar antes do início da consulta. Uma nova data exige um novo pedido de agendamento.",
            "A falta a esta consulta não cria um valor a pagar nem consome saldo ou sessões de pack."
        ] : mode == "Prepayment" ? PublicPresentationContent.PrepaymentCancellations : PublicPresentationContent.OtherCancellations));
        return new(version, mode, label, mode == "Prepayment" ? "Aceito as condições. De seguida farei este pagamento." : "Li e aceito as condições da consulta.",
            sections.ToArray(), payable ? PublicPresentationContent.PaymentInformation : null);
    }
}
