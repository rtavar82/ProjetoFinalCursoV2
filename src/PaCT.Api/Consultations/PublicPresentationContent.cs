namespace PaCT.Api.Consultations;

// Approved public copy, not imported accounts, catalogue entries or commercial values.
// Editing/publication is intentionally outside this increment.
public static class PublicPresentationContent
{
    public sealed record PublicPlace(string Name, string Modality, string Description);
    public static readonly PublicPlace[] Places =
    [
        new("Montijo", "InPerson", LocationDescription("InPerson", "Montijo")),
        new("Online", "Remote", LocationDescription("Remote", "")),
        new("Vila Nova de São Bento", "InPerson", LocationDescription("InPerson", "Vila Nova de São Bento"))
    ];
    public static readonly string[] Experiences = ["Grupo de constelação", SharingWorkshop.Title, "Retiro"];
    public static readonly string[] PrepaymentConditions =
    [
        "Ao escolheres «Aceito as condições. De seguida farei este pagamento.», tens 8 horas para efetuar o pagamento.",
        "O pagamento mantém-se em falta até a terapeuta validar o dinheiro recebido.",
        "Após validação do recebimento, recebes a confirmação final com os detalhes da consulta.",
        "O recebimento fica em crédito;"
    ];
    public static readonly string[] OtherCancellations =
    [
        "Podes cancelar antes do início da consulta, sem perda de crédito. O saldo existente mantém-se disponível na tua conta; não é feita uma devolução do dinheiro. Uma nova data exige um novo pedido de agendamento.",
        "A falta à consulta é gerida sem perda de crédito e não consome saldo nem sessões de pack. Uma nova data exige um novo pedido de agendamento."
    ];
    public static readonly string[] PrepaymentCancellations =
    [
        "Podes cancelar antes do início da consulta sem perda de crédito nem consumo de saldo ou sessões de pack. Os valores existentes mantêm-se disponíveis na tua conta, sem devolução automática do dinheiro. Para escolher uma nova data, é necessário efetuar um novo pedido de agendamento.",
        "A falta à consulta é gerida financeiramente da mesma forma que os cancelamento."
    ];
    public const string ContributionDescription = "Escolhes o valor da tua contribuição de forma livre e consciente. É uma forma de reconhecer o acompanhamento recebido e apoiar a continuidade deste trabalho.";
    public const string ContributionTiming = "A contribuição livre é paga depois da consulta.";

    public static readonly object PaymentInformation = new
    {
        iban = "PT50003300004528411292605", bic = "BCOMPTPL", mbWay = "965 091 479",
        transferNote = "No campo «Notas/Informação para o destinatário», coloca o dia e a hora da consulta.",
        mbWayNote = "Confirma os dados antes de enviar.",
        cashNote = "Pessoalmente, em momento combinado com a terapeuta.",
        advanceCashNote = "Pessoalmente, combinado com a terapeuta antes da consulta.",
        contributionText = ContributionDescription,
        contributionTiming = ContributionTiming,
        contactNote = "Em caso de dúvidas contacta a Terapeuta diretamente para analisar o teu caso.",
        prepayment = new
        {
            termsVersion = ConsultationRules.TermsVersion,
            payments = PrepaymentConditions, cancellations = PrepaymentCancellations,
            // Keep the previous response fields readable by an older, still-open PWA; no obsolete public wording.
            terms = string.Join("\n", PrepaymentConditions), waitNote = "", cancellation = string.Join("\n", PrepaymentCancellations)
        }
    };

    public static string LocationDescription(string modality, string location) => modality == "Remote"
        ? "Por videochamada de WhatsApp ou Google Meet, onde estiveres."
        : location.Trim() switch
        {
            "Vila Nova de São Bento" => "Disponibilidade limitada a dias específicos. Consulta a agenda e filtra por este local.",
            _ => "Sessões presenciais, mediante marcação."
        };

    public static readonly object Therapist = new
    {
        name = "Denise Tavares", role = "Terapeuta de Transformação Feminina",
        heading = "Um caminho de escuta, presença e transformação.",
        introduction = "O meu nome é Denise Tavares. Através das Constelações Familiares, do Reiki e do Desenvolvimento Pessoal, acompanho-te num espaço de escuta e acolhimento, onde podes olhar para o que sentes sem julgamentos.",
        summary = "Através das Constelações Familiares, do Reiki e do Desenvolvimento Pessoal, crio um espaço seguro e sem julgamentos, onde és verdadeiramente escutada.",
        approach = "O meu foco é acompanhar-te na compreensão das tuas dificuldades e na construção de passos que façam sentido para ti, ao teu ritmo.",
        heroImage = "/presentation/denise-junto-ao-mar.png", heroAlt = "Denise Tavares junto ao mar, com as mãos sobre o peito.",
        sections = new[]
        {
            new { heading = "Um percurso que começou em mim", text = "Depois de mais de duas décadas a trabalhar na área da logística, escolhi escutar-me, enfrentar medos e crenças e reconstruir o meu percurso profissional.\n\nEsse caminho de reconciliação com a minha própria história transformou a minha forma de estar no mundo. A procura de uma vida com mais leveza e felicidade, junto da minha família, passou também a dar sentido ao meu trabalho." },
            new { heading = "O que trago para o acompanhamento", text = "Sou uma mulher intensa, autêntica e de coração aberto. Levo essa sensibilidade para a forma como escuto e acompanho quem me procura.\n\nMais do que aplicar técnicas, procuro criar espaço para compreenderes as dificuldades e os padrões que se repetem na tua vida. O meu foco é acompanhar-te na construção de passos que façam sentido para ti, ao teu ritmo." },
            new { heading = "Um espaço para seres verdadeiramente escutada", text = "As Constelações Familiares, o Reiki e o Desenvolvimento Pessoal são as ferramentas através das quais desenvolvo este acompanhamento. A escuta do corpo, das emoções e da tua história tem lugar neste encontro.\n\nO meu convite é que possas parar, reconhecer o que sentes e olhar para o que já não faz sentido carregar. Lado a lado, procuramos abrir espaço para mais clareza, presença e bem-estar." }
        },
        galleryTitle = "Presença e partilha",
        gallery = new[] {
            new { image = "/presentation/denise-partilha-publica.png", alt = "Denise Tavares a falar ao microfone numa partilha em público.", caption = "Um momento de partilha e encontro." },
            new { image = "/presentation/denise-retrato.png", alt = "Retrato de Denise Tavares ao ar livre.", caption = "Autenticidade e coração aberto." }
        },
        closing = "Não tens de olhar para tudo sozinha. Se sentes que este pode ser o teu momento de parar e escutar-te, podemos conversar sobre o acompanhamento que faz sentido para ti.",
        signatureImage = "/presentation/denise-assinatura.png",
        whatsapp = "https://wa.me/351965091479", telephone = "tel:+351965091479", instagram = "https://www.instagram.com/denise_tavares_terapias/"
    };

    public static ServicePresentation? ServiceText(string title) => title switch
    {
        "Sessão Individual de Constelação Familiar" => new("Olhar para o que se repete.", "Um espaço para explorar dinâmicas familiares, relações e padrões que sentes como bloqueios, e abrir novas perspetivas para o teu caminho."),
        "Sessão de Reiki & Alinhamento Energético" => new("Um momento de pausa e cuidado.", "Uma sessão dedicada ao relaxamento, à escuta e ao equilíbrio pessoal. Um convite para abrandares e te reconectares contigo."),
        "Consultas \"Sentir Além do Olhar\"" or "Consultas “Sentir Além do Olhar”" => new("Um caminho, lado a lado.", "Acompanhamento de Desenvolvimento Pessoal e Consciência. Um espaço individual para escutar o que sentes e construir, com Constelações e outras ferramentas integrativas, um mapa de evolução adaptado ao teu momento."),
        _ => null
    };
}
