using System.Net.Mail;

namespace PaCT.Api.Identity;

public static class IdentityValidation
{
    public const string PhoneRequiredMessage = "Preenche o telefone.";
    public static (string DialCode, string Number) RequiredPhone(string? dialCode, string? number)
    {
        if (string.IsNullOrWhiteSpace(number)) throw new IdentityProblem(400, PhoneRequiredMessage);
        var phone = Required(number, 40, "o telefone");
        var dial = dialCode?.Trim();
        if (dial?.StartsWith('+') == true) dial = dial[1..];
        if (dial is null || dial.Length is < 1 or > 3 || !dial.All(char.IsAsciiDigit)) throw new IdentityProblem(400, "Indica um indicativo com 1 a 3 algarismos.");
        if (phone.Any(c => !char.IsAsciiDigit(c) && c is not (' ' or '(' or ')' or '-' or '+'))) throw new IdentityProblem(400, "Indica um telefone válido.");
        if (phone.Contains('+') && (!phone.StartsWith('+') || phone.LastIndexOf('+') != 0)) throw new IdentityProblem(400, "Usa + apenas no início do telefone internacional.");
        var international = phone.StartsWith('+') || phone.StartsWith("00", StringComparison.Ordinal);
        var digits = new string(phone.Where(char.IsAsciiDigit).ToArray());
        if (international)
        {
            if (phone.StartsWith("00", StringComparison.Ordinal)) digits = digits[2..];
            if (!digits.StartsWith(dial, StringComparison.Ordinal)) throw new IdentityProblem(400, "O telefone internacional não corresponde ao indicativo escolhido.");
            digits = digits[dial.Length..];
        }
        if (digits.Length is < 3 or > 14 || digits.Length + dial.Length > 15) throw new IdentityProblem(400, "Indica um telefone válido para o indicativo escolhido.");
        return (dial, digits);
    }
    public static string? MissingNameMessage(string? firstName, string? lastName) =>
        string.IsNullOrWhiteSpace(firstName) ? "Preenche o nome." : string.IsNullOrWhiteSpace(lastName) ? "Preenche o apelido." : null;

    public static string Required(string? value, int maximum, string label)
    {
        var result = value?.Trim() ?? "";
        if (result.Length == 0 || result.Length > maximum || result.Any(char.IsControl))
            throw new IdentityProblem(400, $"Preenche {label}, até {maximum} caracteres.");
        return result;
    }
    public static string Email(string? value)
    {
        var result = Required(value, 256, "o email");
        if (!MailAddress.TryCreate(result, out var address) || address.Address != result || !result.Contains('@'))
            throw new IdentityProblem(400, "Indica um email válido.");
        return result;
    }
    public static void Password(string? value, string? confirmation)
    {
        if (value != confirmation) throw new IdentityProblem(400, "As palavras-passe não coincidem.");
        if (value is null || value.Length is < 12 or > 128 || !value.Any(char.IsUpper) || !value.Any(char.IsLower)
            || !value.Any(char.IsDigit) || !value.Any(c => !char.IsLetterOrDigit(c) && !char.IsWhiteSpace(c)))
            throw new IdentityProblem(400, "Usa 12 a 128 caracteres, com maiúscula, minúscula, algarismo e símbolo.");
    }
}
