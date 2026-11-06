using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Management;

public sealed record SiteField(string Key, string Label, string Value, int Maximum, bool Multiline = false, bool Optional = false);
public sealed record SitePublication(long Version, Dictionary<string, string> Changes)
{
    public string Text(string key, string fallback) => Changes.GetValueOrDefault(key, fallback);
}

public static class SitePresentation
{
    public static readonly SitePublication Default = new(0, []);
    private static readonly SiteField[] Home =
    [
        new("heroTitle", "Título de boas-vindas", "Bem-vinda ao teu espaço de", 160),
        new("heroEmphasis", "Destaque do título", "libertação e leveza.", 100),
        new("heroIntroduction", "Texto de boas-vindas", "Quando as mesmas dinâmicas se repetem e o peso do dia a dia se torna demasiado, não tens de olhar para tudo sozinha.", 2000, true),
        new("heroNote", "Texto junto à imagem", "Um tempo para parar.\nUm espaço para ti.", 300, true),
        new("companionLabel", "Título da secção da terapeuta", "Quem te acompanha", 160),
        new("servicesLabel", "Chamada para os serviços", "Como te posso ajudar hoje?", 160),
        new("servicesTitle", "Título da secção de serviços", "Escolhe o teu ponto de partida.", 160),
        new("servicesIntroduction", "Introdução aos serviços", "Sessões individuais, presenciais ou online, para diferentes momentos do teu caminho.", 2000, true),
        new("experiencesLabel", "Chamada para as experiências", "Experiências em grupo", 160),
        new("experiencesTitle", "Título da secção de experiências", "Partilhar também faz parte do caminho.", 160),
        new("experiencesIntroduction", "Introdução às experiências", "Grupos, oficinas e retiros decorrem em datas próprias, com vagas limitadas.", 2000, true),
        new("placesLabel", "Chamada para os locais", "Ao teu encontro", 160),
        new("placesTitle", "Título da secção de locais", "Presencial ou à distância.", 160),
        new("helpTitle", "Título da secção de contacto", "Não sabes por onde começar?", 160),
        new("helpText", "Texto de contacto", "Fala com a Denise para perceber qual o serviço que faz sentido para o teu momento. Os pedidos de consulta aguardam confirmação.", 2000, true),
        new("socialTitle", "Título da secção de redes sociais", "Acompanha-me também nas redes sociais.", 160)
    ];

    public static SiteField[] Fields(string section) => section switch
    {
        "Home" => Home,
        "Therapist" => TherapistFields(),
        "Contacts" => ContactFields(),
        "Payment" => PaymentFields(),
        "Places" => [new("place.Online.description", "Online — descrição pública", PublicPresentationContent.LocationDescription("Remote"), 600, true)],
        _ => throw new IdentityProblem(404, "Área de edição desconhecida.")
    };

    public static Dictionary<string, string> Validate(string section, Dictionary<string, string>? values)
    {
        var fields = Fields(section);
        if (values is null || values.Count != fields.Length) throw new IdentityProblem(400, "Revê os campos desta secção.");
        var normalized = fields.ToDictionary(field => field.Key, field =>
        {
            if (!values.TryGetValue(field.Key, out var value))
                throw new IdentityProblem(400, "Revê os campos desta secção.");
            var text = value?.Trim().ReplaceLineEndings("\n") ?? "";
            if (!field.Optional && text.Length == 0 || text.Length > field.Maximum || text.Any(c => char.IsControl(c) && !(field.Multiline && c == '\n')))
                throw new IdentityProblem(400, $"Revê «{field.Label}». O limite é de {field.Maximum} caracteres.");
            return text;
        });
        if (normalized.Values.Sum(text => text.Length) > 40000)
            throw new IdentityProblem(400, "O conteúdo desta secção é demasiado longo.");
        if (section == "Contacts") ValidateContacts(normalized);
        if (section == "Payment") ValidatePayment(normalized);
        return normalized;
    }

    public static Dictionary<string, string> PublicHome(SitePublication publication) =>
        Home.ToDictionary(field => field.Key, field => publication.Text(field.Key, field.Value));

    public static JsonObject PublicTherapist(SitePublication publication)
        => PublicTherapist(publication, out _);

    internal static JsonObject PublicTherapist(SitePublication publication, out SiteImageField[] images)
    {
        var person = JsonSerializer.SerializeToNode(PublicPresentationContent.Therapist)!.AsObject();
        foreach (var field in TherapistFields().Concat(ContactFields()))
        {
            var path = field.Key.Split('.');
            if (path.Length == 2) person[path[1]] = publication.Text(field.Key, field.Value);
            else person[path[1]]![int.Parse(path[2])]![path[3]] = publication.Text(field.Key, field.Value);
        }
        images = SitePresentationImages.Project(publication, person);
        return person;
    }

    public static JsonObject PublicPayment(SitePublication publication)
    {
        var payment = JsonSerializer.SerializeToNode(PublicPresentationContent.PaymentInformation)!.AsObject();
        foreach (var field in PaymentFields()) payment[field.Key["payment.".Length..]] = publication.Text(field.Key, field.Value);
        return payment;
    }

    private static SiteField[] ContactFields()
    {
        var person = JsonSerializer.SerializeToElement(PublicPresentationContent.Therapist);
        return
        [
            new("therapist.telephone", "Telefone (tel:+351…)", person.GetProperty("telephone").GetString()!, 25, Optional: true),
            new("therapist.whatsapp", "Ligação WhatsApp (https://wa.me/…)", person.GetProperty("whatsapp").GetString()!, 60, Optional: true),
            new("therapist.instagram", "Ligação Instagram (https://www.instagram.com/…/)", person.GetProperty("instagram").GetString()!, 120, Optional: true)
        ];
    }

    private static SiteField[] PaymentFields()
    {
        var payment = JsonSerializer.SerializeToElement(PublicPresentationContent.PaymentInformation);
        SiteField Field(string key, string label, int limit, bool optional = false) =>
            new("payment." + key, label, payment.GetProperty(key).GetString()!, limit, Multiline: limit > 100, Optional: optional);
        return
        [
            Field("iban", "IBAN", 40, true),
            Field("bic", "BIC/SWIFT", 11, true),
            Field("transferNote", "Instruções de transferência bancária", 600),
            Field("mbWay", "Número MB WAY", 20, true),
            Field("mbWayNote", "Instruções de MB WAY", 600),
            Field("cashNote", "Instruções para pagamento em dinheiro", 600),
            Field("advanceCashNote", "Instruções para pagamento antecipado em dinheiro", 600),
            Field("contactNote", "Texto de ajuda sobre pagamentos", 600)
        ];
    }

    private static void ValidateContacts(Dictionary<string, string> values)
    {
        if (values["therapist.telephone"] is { Length: > 0 } telephone && !Regex.IsMatch(telephone, @"\Atel:\+[1-9][0-9]{6,14}\z"))
            throw new IdentityProblem(400, "Indica o telefone no formato tel:+351 seguido do número.");
        if (values["therapist.whatsapp"] is { Length: > 0 } whatsapp && !Regex.IsMatch(whatsapp, @"\Ahttps://wa\.me/[1-9][0-9]{6,14}\z"))
            throw new IdentityProblem(400, "Indica uma ligação https://wa.me/ seguida do número com indicativo.");
        if (values["therapist.instagram"] is { Length: > 0 } instagram && !Regex.IsMatch(instagram, @"\Ahttps://www\.instagram\.com/[a-zA-Z0-9_.]+/\z"))
            throw new IdentityProblem(400, "Indica a ligação HTTPS do perfil de Instagram, com uma barra no fim.");
    }

    private static void ValidatePayment(Dictionary<string, string> values)
    {
        var iban = values["payment.iban"].Replace(" ", "").ToUpperInvariant();
        var bic = values["payment.bic"].ToUpperInvariant();
        var mbWay = values["payment.mbWay"].Replace(" ", "");
        if (iban.Length > 0 && (!Regex.IsMatch(iban, @"\APT[0-9]{23}\z")
            || (iban[4..] + "2529" + iban[2..4]).Aggregate(0, (remainder, digit) => (remainder * 10 + digit - '0') % 97) != 1))
            throw new IdentityProblem(400, "Indica um IBAN português válido.");
        if (bic.Length > 0 && (iban.Length == 0 || !Regex.IsMatch(bic, @"\A[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?\z")))
            throw new IdentityProblem(400, "Indica um BIC/SWIFT válido associado ao IBAN.");
        if (mbWay.Length > 0 && !Regex.IsMatch(mbWay, @"\A[0-9]{9}\z"))
            throw new IdentityProblem(400, "Indica os nove algarismos do número MB WAY.");
        values["payment.iban"] = iban;
        values["payment.bic"] = bic;
        values["payment.mbWay"] = mbWay.Length == 0 ? "" : $"{mbWay[..3]} {mbWay[3..6]} {mbWay[6..]}";
    }

    public static string LocationDescription(SitePublication publication, string modality, string location)
    {
        var name = modality == "Remote" ? "Online" : location;
        return publication.Text($"place.{name}.description", PublicPresentationContent.LocationDescription(modality));
    }

    public static ConsultationService WithAddress(SitePublication publication, ConsultationService service, string location)
    {
        if (service.Modality != "InPerson" || !string.IsNullOrWhiteSpace(service.Instructions)) return service;
        var address = SiteLocations.Address(publication, location);
        return service with { Instructions = address };
    }

    private static SiteField[] TherapistFields()
    {
        var person = JsonSerializer.SerializeToElement(PublicPresentationContent.Therapist);
        SiteField Field(string key, string label, int limit, bool multiline = false) =>
            new("therapist." + key, label, person.GetProperty(key).GetString()!, limit, multiline);
        return
        [
            Field("name", "Nome", 160),
            Field("role", "Função", 200),
            Field("heading", "Título de apresentação", 240),
            Field("introduction", "Apresentação", 2000, true),
            Field("summary", "Resumo apresentado no Início", 2000, true),
            Field("approach", "Abordagem apresentada no Início", 2000, true),
            Field("heroAlt", "Descrição acessível da fotografia principal", 500),
            .. person.GetProperty("sections").EnumerateArray().SelectMany((section, index) => new SiteField[]
            {
                new($"therapist.sections.{index}.heading", $"Secção {index + 1} — título", section.GetProperty("heading").GetString()!, 200),
                new($"therapist.sections.{index}.text", $"Secção {index + 1} — texto", section.GetProperty("text").GetString()!, 10000, true)
            }),
            Field("galleryTitle", "Título da galeria", 200),
            .. person.GetProperty("gallery").EnumerateArray().SelectMany((photo, index) => new SiteField[]
            {
                new($"therapist.gallery.{index}.alt", $"Fotografia {index + 1} — descrição acessível", photo.GetProperty("alt").GetString()!, 500),
                new($"therapist.gallery.{index}.caption", $"Fotografia {index + 1} — legenda", photo.GetProperty("caption").GetString()!, 500)
            }),
            Field("closing", "Texto final", 2000, true)
        ];
    }
}
