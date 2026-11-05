using System.Text.Json;
using System.Text.Json.Nodes;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;

namespace PaCT.Api.Management;

public sealed record SiteField(string Key, string Label, string Value, int Maximum, bool Multiline = false);
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
        "Places" => PublicPresentationContent.Places.SelectMany(place =>
        {
            var description = new SiteField($"place.{place.Name}.description", $"{place.Name} — descrição pública", place.Description, 600, true);
            return place.Modality == "Remote" ? [description] : new[]
            {
                description, new SiteField($"place.{place.Name}.address", $"{place.Name} — morada completa", AppointmentCommunications.Instructions("InPerson", place.Name, ""), 500)
            };
        }).ToArray(),
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
            if (text.Length == 0 || text.Length > field.Maximum || text.Any(c => char.IsControl(c) && !(field.Multiline && c == '\n')))
                throw new IdentityProblem(400, $"Revê «{field.Label}». O limite é de {field.Maximum} caracteres.");
            return text;
        });
        if (normalized.Values.Sum(text => text.Length) > 40000)
            throw new IdentityProblem(400, "O conteúdo desta secção é demasiado longo.");
        return normalized;
    }

    public static Dictionary<string, string> PublicHome(SitePublication publication) =>
        Home.ToDictionary(field => field.Key, field => publication.Text(field.Key, field.Value));

    public static JsonObject PublicTherapist(SitePublication publication)
    {
        var person = JsonSerializer.SerializeToNode(PublicPresentationContent.Therapist)!.AsObject();
        foreach (var field in TherapistFields())
        {
            var path = field.Key.Split('.');
            if (path.Length == 2) person[path[1]] = publication.Text(field.Key, field.Value);
            else person[path[1]]![int.Parse(path[2])]![path[3]] = publication.Text(field.Key, field.Value);
        }
        return person;
    }

    public static string LocationDescription(SitePublication publication, string modality, string location)
    {
        var name = modality == "Remote" ? "Online" : location;
        return publication.Text($"place.{name}.description", PublicPresentationContent.LocationDescription(modality, location));
    }

    public static ConsultationService WithAddress(SitePublication publication, ConsultationService service, string location)
    {
        if (service.Modality != "InPerson" || !string.IsNullOrWhiteSpace(service.Instructions)) return service;
        var address = publication.Text($"place.{location}.address", AppointmentCommunications.Instructions("InPerson", location, ""));
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
