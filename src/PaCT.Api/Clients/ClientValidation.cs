using System.Globalization;
using System.Text;
using PaCT.Api.Identity;

namespace PaCT.Api.Clients;

public static class ClientValidation
{
    public const string PhoneRequiredMessage = IdentityValidation.PhoneRequiredMessage;
    public const string ContactRequiredMessage = "Indica pelo menos um contacto: email ou telefone.";
    public const string BirthDateRequiredMessage = "Preenche a data de nascimento para guardar a tua ficha.";
    public static bool HasPhone(ClientProfile input) => !string.IsNullOrWhiteSpace(input.Phone);
    public static bool HasContact(ClientProfile input) => !string.IsNullOrWhiteSpace(input.Email) || HasPhone(input);
    public static string? MissingRegistrationMessage(ClientProfile input) =>
        IdentityValidation.MissingNameMessage(input.FirstName, input.LastName)
        ?? (string.IsNullOrWhiteSpace(input.Email) ? "Preenche o email." : null)
        ?? (!HasPhone(input) ? PhoneRequiredMessage : null)
        ?? (input.BirthDate is null ? BirthDateRequiredMessage : null)
        ?? (string.IsNullOrWhiteSpace(input.Gender) ? "Seleciona o género." : null)
        ?? (string.IsNullOrWhiteSpace(input.Locality) ? "Preenche a localidade." : null);

    public static ClientProfile ValidateRegistration(ClientProfile input, DateOnly today)
    {
        if (MissingRegistrationMessage(input) is { } message) throw new IdentityProblem(400, message);
        return Validate(input, true, today, requireBirthDate: true);
    }
    public static readonly string[] SelectableFields = ["FirstName", "LastName", "Locality", "BirthDate", "Gender", "Email", "Phone", "Address", "PostalCode", "ChildrenCount", "RelationshipStatus", "DisplayName"];
    public static string NormalizeName(string value) => string.Join(' ', new string(value.Trim().Normalize(NormalizationForm.FormD)
        .Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark).ToArray())
        .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).ToUpperInvariant();

    public static ClientProfile Validate(ClientProfile input, bool manual, DateOnly today, bool requireBirthDate = false)
    {
        string? Field(string? value, int max, string label) => string.IsNullOrWhiteSpace(value) ? null : IdentityValidation.Required(value, max, label);
        var first = Field(input.FirstName, 100, "o primeiro nome");
        var last = Field(input.LastName, 100, "o apelido");
        var locality = Field(input.Locality, 150, "a localidade");
        if (IdentityValidation.MissingNameMessage(first, last) is { } missingName) throw new IdentityProblem(400, missingName);
        if (manual && locality is null) throw new IdentityProblem(400, "Preenche a localidade para criar a ficha manual.");
        var email = string.IsNullOrWhiteSpace(input.Email) ? null : IdentityValidation.Email(input.Email);
        string? phone = null, dial = null;
        if (HasPhone(input)) (dial, phone) = IdentityValidation.RequiredPhone(input.DialCode, input.Phone);
        if (!HasContact(input)) throw new IdentityProblem(400, ContactRequiredMessage);
        if (requireBirthDate && input.BirthDate is null) throw new IdentityProblem(400, BirthDateRequiredMessage);
        if (input.BirthDate > today) throw new IdentityProblem(400, "A data de nascimento não pode ser futura.");
        if (input.Gender is not (null or "" or "Male" or "Female")) throw new IdentityProblem(400, "Seleciona um género válido.");
        if (input.ChildrenCount is < 0 or > 65535) throw new IdentityProblem(400, "O número de filhos deve ser um inteiro não negativo.");
        if (input.RelationshipStatus is not (null or "" or "Married" or "Separated" or "Partnered" or "Unpartnered" or "Widowed"))
            throw new IdentityProblem(400, "Seleciona uma situação pessoal válida.");
        return input with { FirstName = first, LastName = last, Locality = locality, Email = email, Phone = phone, DialCode = dial,
            Gender = Field(input.Gender, 9, "o género"), RelationshipStatus = Field(input.RelationshipStatus, 20, "a situação pessoal"),
            Address = Field(input.Address, 1000, "a morada"), PostalCode = Field(input.PostalCode, 30, "o código postal"), DisplayName = Field(input.DisplayName, 201, "o nome público") };
    }
    public static ClientProfile Select(ClientProfile current, ClientProfile source, string[] fields)
    {
        if (fields.Any(field => !SelectableFields.Contains(field, StringComparer.Ordinal))) throw new IdentityProblem(400, "A seleção contém campos não permitidos.");
        bool Has(string field) => fields.Contains(field, StringComparer.Ordinal);
        return current with { FirstName = Has("FirstName") ? source.FirstName : current.FirstName,
            LastName = Has("LastName") ? source.LastName : current.LastName, Locality = Has("Locality") ? source.Locality : current.Locality,
            BirthDate = Has("BirthDate") ? source.BirthDate : current.BirthDate, Gender = Has("Gender") ? source.Gender : current.Gender,
            Email = Has("Email") ? source.Email : current.Email,
            Phone = Has("Phone") ? source.Phone : current.Phone, DialCode = Has("Phone") ? source.DialCode : current.DialCode,
            Address = Has("Address") ? source.Address : current.Address, PostalCode = Has("PostalCode") ? source.PostalCode : current.PostalCode,
            ChildrenCount = Has("ChildrenCount") ? source.ChildrenCount : current.ChildrenCount,
            RelationshipStatus = Has("RelationshipStatus") ? source.RelationshipStatus : current.RelationshipStatus,
            DisplayName = Has("DisplayName") ? source.DisplayName : current.DisplayName };
    }
}
