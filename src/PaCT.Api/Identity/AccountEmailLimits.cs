namespace PaCT.Api.Identity;

internal static class AccountEmailLimits
{
    // Called inside the existing account-security transaction, after validation and idempotency checks.
    // Only actions that queued a new email count; invalid attempts and replays never use this budget.
    internal static void Check(IEnumerable<ClientAccessAction> actions, string kind, string author, DateTime now)
    {
        var recent = actions.Where(action => action.Kind == kind && action.CreatedByAccountId == author
            && action.CreatedAt > now.AddMinutes(-15)).OrderByDescending(action => action.CreatedAt).Take(3).ToArray();
        if (recent.Length < 3) return;
        var seconds = Math.Max(1, (int)Math.Ceiling((recent[^1].CreatedAt.AddMinutes(15) - now).TotalSeconds));
        throw new IdentityProblem(429, "Já foram pedidos três envios deste tipo nos últimos 15 minutos. Aguarda antes de voltar a tentar.", seconds);
    }
}
