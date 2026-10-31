namespace PaCT.Api.Consultations;

public sealed record PublicConditionSection(string Title, string[] Paragraphs);
public sealed record PublicExperiencePresentation(string Key, string Title, string ServiceKind,
    string Introduction, string Description, string DurationText, string PriceText, PublicConditionSection[] Conditions,
    bool IsFree = false, string[]? ServiceTitles = null);
public sealed record PublicPackOffer(string Description, string DurationText, string PaymentText, string UsageText);

public static class PublicExperienceContent
{
    public static bool IsSentir(string title) => title.Replace('“', '"').Replace('”', '"').Trim()
        .Equals("Consultas \"Sentir Além do Olhar\"", StringComparison.OrdinalIgnoreCase);

    public static readonly PublicPackOffer NegotiatedPack = new(
        "Podes combinar um pack diretamente com a terapeuta. O número de sessões, os serviços abrangidos e o preço promocional são acordados individualmente.",
        "Os packs têm uma duração de um ano desde a compra. No final, a gestão revê contigo as sessões ainda disponíveis.",
        "O pack fica ativo depois do pagamento integral e da utilização expressa do saldo monetário para a compra. Não existe pack promocional pago sessão a sessão.",
        "Agendar não compra o pack nem utiliza sessões. Uma sessão só é descontada no fecho de uma consulta realizada, por escolha expressa da gestão. O Saldo Pack é separado do saldo em euros e não pode pagar retiros.");

    private static PublicConditionSection[] GroupConditions() =>
    [
        new("Inscrição", [
            "Se tens conta PaCT, a inscrição fica confirmada quando existe vaga. A confirmação da inscrição não confirma o pagamento.",
            "Sem conta PaCT, podes pedir a inscrição na Agenda. O pedido aguarda confirmação e ocupa provisoriamente uma vaga; os contactos posteriores são tratados diretamente com a terapeuta."
        ]),
        new("Pagamento", [
            "Consulta o valor e as condições da sessão publicada na Agenda. Pode ser exigido pagamento antecipado.",
            "Cada participante tem uma situação financeira própria. A gestão pode confirmar a utilização parcial ou total de crédito monetário. Uma sessão de Saldo Pack elegível cobre a consulta completa e não pode ser combinada com pagamentos monetários nessa consulta."
        ]),
        new("Cancelamentos ou faltas", [
            "Podes cancelar antes do início da consulta, sem penalização financeira automática. Uma nova data exige uma nova inscrição.",
            "A falta fica sem dívida e não consome saldo monetário nem sessões de pack."
        ])
    ];

    public static readonly PublicExperiencePresentation[] Presentations =
    [
        new("constelacao-grupo", "Grupo de constelação", "Group", "Um olhar partilhado, em grupo.",
            "Um encontro de Constelação Familiar em grupo para explorar dinâmicas familiares, relações e padrões, num espaço de escuta e partilha. A sessão reúne vários participantes e cada pessoa tem a sua própria inscrição.",
            "Duração definida em cada sessão", "Valor e condições publicados na Agenda", GroupConditions()),
        new("oficina-dons-cura", SharingWorkshop.Title, "Group", "Um encontro de partilha e experiências.",
            "Um encontro em grupo para partilhar dons, talentos e experiências. O tema, as atividades e as condições de participação são apresentados em cada encontro publicado.",
            "Duração definida em cada encontro", "Participação gratuita",
            [
                new("Participação", [
                    "Este é um encontro gratuito de partilha e experiências.",
                    "Consulta na Agenda as datas, o local, as vagas e as condições de participação."
                ]),
                new("Inscrição", [
                    "Com conta PaCT, a inscrição fica confirmada quando existe vaga.",
                    "Sem conta PaCT, podes pedir a inscrição na Agenda. O pedido aguarda confirmação e os contactos posteriores são tratados diretamente com a terapeuta."
                ]),
                new("Cancelamentos ou faltas", [
                    "Podes cancelar antes do início do encontro. Para outra data, faz um novo pedido de inscrição."
                ])
            ], IsFree: true, ServiceTitles: [SharingWorkshop.PreviousTitle]),
        new("retiro", "Retiro", "Retreat", "Mais tempo para parar e estar presente.",
            "Uma experiência de um ou vários dias, com um programa que pode incluir meditação, Reiki e outras atividades. Uma única inscrição abrange o retiro completo e todas as atividades incluídas no programa.",
            "Um ou vários dias, conforme o programa", "Preço único por participante, definido para cada retiro",
            [
                new("Programa e inscrição", [
                    "Consulta na Agenda o programa, as datas, o local, as vagas e as condições do retiro. Não são necessárias inscrições separadas para as atividades incluídas.",
                    "Com conta PaCT, a inscrição fica confirmada se existir vaga. Sem conta, o pedido aguarda confirmação e os contactos posteriores são tratados diretamente com a terapeuta."
                ]),
                new("Pagamento", [
                    "O preço é igual para todos os participantes do mesmo retiro. O pagamento é integral, conforme as condições publicadas para o retiro.",
                    "A confirmação da inscrição não confirma o recebimento nem utiliza automaticamente saldo monetário. O Saldo Pack não pode ser utilizado para pagar retiros."
                ]),
                new("Desistência do participante", [
                    "Com conta PaCT, podes cancelar diretamente antes do início do retiro. A vaga fica indisponível até decisão da gestão. Sem conta, contacta diretamente a terapeuta.",
                    "Aplicam-se as condições de cancelamento do retiro, que podem prever devolução integral, parcial ou retenção de valores. O cancelamento não movimenta dinheiro automaticamente."
                ]),
                new("Cancelamento pela organização", [
                    "Se a organização cancelar o retiro, tens direito à restituição integral dos valores pagos e aplicados à inscrição, sem retenções ou penalizações.",
                    "A restituição é tratada expressamente pela gestão e pode ser feita em dinheiro ou em saldo monetário na PaCT, mediante acordo contigo."
                ])
            ])
    ];
}
