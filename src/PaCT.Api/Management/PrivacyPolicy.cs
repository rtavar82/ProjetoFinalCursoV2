using PaCT.Api.Identity;

namespace PaCT.Api.Management;

public sealed record PrivacyControllerDetails(string Name, string Email)
{
    internal PrivacyControllerDetails Validate() => new(
        IdentityValidation.Required(Name, 200, "o nome do responsável pelo tratamento"),
        IdentityValidation.Email(Email));
}

public sealed record PrivacyContent(string ControllerName, string ContactEmail, string Summary, string Text, string PushNotice)
{
    internal PrivacyContent Validate()
    {
        var details = new PrivacyControllerDetails(ControllerName, ContactEmail).Validate();
        var text = Text?.Replace("\r\n", "\n").Trim() ?? "";
        if (text.Length is 0 or > 18000 || text.Any(character => char.IsControl(character) && character is not ('\n' or '\t')))
            throw new IdentityProblem(400, "Preenche o texto da política, até 18000 caracteres.");
        return new(details.Name, details.Email, IdentityValidation.Required(Summary, 450, "o resumo"), text,
            IdentityValidation.Required(PushNotice, 450, "o aviso de notificações"));
    }

    internal string[] PendingSections()
    {
        var pending = new List<string>();
        var section = "Texto da política";
        foreach (var line in Text.Split('\n'))
        {
            if (line.Contains("[Completar antes de publicar:", StringComparison.OrdinalIgnoreCase))
                pending.Add(section);
            else if (line.StartsWith("# ", StringComparison.Ordinal) && !string.IsNullOrWhiteSpace(line[2..]))
                section = line[2..].Trim();
        }
        return pending.Distinct(StringComparer.Ordinal).ToArray();
    }

    internal static PrivacyContent Draft(PrivacyControllerDetails? details = null) => new(
        details?.Name ?? "", details?.Email ?? "",
        "Consulta como a PaCT utiliza os teus dados e como podes exercer os teus direitos. Podes voltar a esta informação no Meu perfil.",
        """
        # Que dados utilizamos e para quê

        Utilizamos os dados de identificação e contacto para gerir a tua conta, pedidos, marcações e comunicações sobre os serviços. A gestão financeira conserva os registos necessários para pagamentos, compras e cumprimento das obrigações legais. Utilizamos dados técnicos para proteger o acesso e a segurança da PaCT.

        O conteúdo do acompanhamento fica disponível às pessoas autorizadas. Uma publicação em Partilhas ou um testemunho público pode ser visto por visitantes. Evita publicar dados de terceiros ou informação íntima.

        # Fundamentos do tratamento

        [Completar antes de publicar: indicar o fundamento aplicável a cada finalidade. Se houver tratamento de dados de saúde ou de outras categorias especiais, identificar também a condição aplicável do artigo 9.º do RGPD.]

        # Quem pode receber os dados

        [Completar antes de publicar: identificar os destinatários ou categorias, incluindo os serviços efetivamente usados para alojamento, email, autenticação, notificações e videochamadas. Indicar as transferências para fora do EEE e garantias aplicáveis, quando existirem.]

        # Durante quanto tempo

        [Completar antes de publicar: indicar prazos ou critérios por categoria, incluindo contas, marcações, registos financeiros, notas e conteúdos multimédia. Rever a finalidade e a necessidade de conservar os conteúdos durante três anos e indicar quando se conta esse prazo.]

        # Os teus direitos

        Podes pedir acesso, retificação, apagamento ou limitação dos teus dados e, quando aplicável, portabilidade ou oposição. Podes retirar consentimentos a qualquer momento. Usa o contacto indicado nesta política para exercer os teus direitos. Podes também apresentar uma reclamação à Comissão Nacional de Proteção de Dados (CNPD).

        [Completar antes de publicar: indicar os dados necessários para o serviço e as consequências de não os fornecer, os contactos adicionais e a informação sobre decisões automatizadas, quando aplicável.]
        """,
        "Se autorizares, podes ativar avisos PaCT no navegador ou telemóvel. Podes retirar a autorização em Meu perfil. Os avisos na aplicação continuam disponíveis.");
}

public sealed record PrivacyPublication(long Version, PrivacyContent Content, DateTime PublishedAt, bool TestOnly = false);
public sealed record PrivacyRevision(long Version, string AuthorId, DateTime PublishedAt, bool TestOnly = false);
public sealed record PrivacyEditor(long Revision, long PublishedVersion, PrivacyContent Draft, DateTime? UpdatedAt,
    PrivacyRevision[] History, int Total, string[] PendingSections, bool CanPublishTest, bool PublishedTestOnly);
internal sealed record PrivacyPublishResult(int Status, PrivacyPublication? Publication = null, string? Message = null);
public sealed record PrivacyDraftInput(long Revision, PrivacyContent Content);
public sealed record PrivacyChoiceInput(Guid OperationId, long Version, string Purpose, bool Accepted);
public sealed record PrivacyChoice(long Version, string Purpose, bool Accepted, DateTime DecidedAt);

internal static class PrivacyPurposes
{
    internal const string Reading = "reading";
    internal const string Push = "push";
}
