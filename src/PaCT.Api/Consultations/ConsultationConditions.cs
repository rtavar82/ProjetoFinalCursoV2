namespace PaCT.Api.Consultations;

public sealed record ConditionSection(string Title, string[] Paragraphs, string[] Bullets);
public sealed record ConsultationConditionSet(string Version, string Mode, string Label, string AcceptLabel,
    ConditionSection[] Sections, object? PaymentInformation)
{
    public string Text => string.Join("\n\n", Sections.Select(section => string.Join("\n", new[] { section.Title }.Concat(section.Paragraphs).Concat(section.Bullets))));
}

public static class ConsultationConditions
{
    public static string Mode(Consultation c) => c.FinancialChoice == "Prepayment" && c.AdvanceSatisfiedAt is not null
        ? "Credit" : c.FinancialChoice ?? c.Service.PaymentMode;
    public static string Version(Consultation c) => Mode(c) == "Prepayment" ? ConsultationRules.TermsVersion : ConsultationRules.TermsVersion + ":" + Mode(c);
    public static bool Pending(Consultation c, DateTimeOffset now) => c.AcceptedAt is null && ProcessLifecycle.Substate(c, now) == "Confirmed";
    public static ConsultationConditionSet Describe(Consultation c)
    {
        var mode = Mode(c);
        return DescribeMode(mode, Version(c));
    }
    public static ConsultationConditionSet DescribeMode(string mode, string version)
    {
        var payable = mode is "Prepayment" or "Postpayment" or "Contribution";
        var label = mode switch { "Prepayment" => "Pagamento antecipado", "Postpayment" => "Pagamento depois da consulta",
            "Contribution" => "Contribuição livre, paga depois da consulta", "Credit" => "Crédito disponível na conta", _ => "Sem pagamento" };
        string[] paragraphs = mode switch
        {
            "Prepayment" => [],
            "Contribution" => [PublicPresentationContent.ContributionDescription, PublicPresentationContent.ContributionTiming],
            "Postpayment" => ["O pagamento é feito depois da consulta."],
            "Gift" => ["Esta consulta foi oferecida pela terapeuta. Não tens pagamento a efetuar por esta consulta."],
            "Credit" => ["O crédito confirmado na tua conta dispensa um novo pagamento antecipado. O saldo não é descontado ao aceitares estas condições; a utilização do crédito é tratada no fecho ou depois da consulta."],
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
