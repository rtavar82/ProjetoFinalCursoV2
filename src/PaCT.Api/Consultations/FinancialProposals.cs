using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public static class FinancialProposals
{
    public static CreditUseProposal[] End(CreditUseProposal[] proposals, string author, DateTimeOffset now) =>
        proposals.Select(p => p.Decision is null ? p with { Decision = "Cancelled", DecidedBy = author, DecidedAt = now } : p).ToArray();
    public static CreditUseProposal[] Create(CreditUseProposal[] proposals, ConsultationCommand input,
        ConsultationActor actor, DateTimeOffset now, decimal balance, decimal remaining)
    {
        if (actor.IsManager) throw new IdentityProblem(403, "A proposta é comunicada pelo cliente.");
        if (input.Amount is not { } amount || amount <= 0 || decimal.Round(amount, 2) != amount || amount > balance || amount > remaining)
            throw new IdentityProblem(409, "Indica um valor até ao crédito disponível e à dívida existente.");
        if (proposals.Any(p => p.Decision is null)) throw new IdentityProblem(409, "Já existe uma proposta por verificar pela gestão.");
        return [..proposals, new(input.OperationId, actor.AccountId, amount, now)];
    }

    public static CreditUseProposal[] Resolve(CreditUseProposal[] proposals, string? id,
        ConsultationActor actor, DateTimeOffset now, string decision, decimal? appliedAmount = null)
    {
        if (!actor.IsManager) throw new IdentityProblem(403, "Só a gestão pode decidir a utilização do crédito.");
        if (id is null && decision != "Declined") return proposals.Select(p => p.Decision is null
            ? p with { Decision = decision, DecidedBy = actor.AccountId, DecidedAt = now, AppliedAmount = appliedAmount } : p).ToArray();
        if (!proposals.Any(p => p.Id == id && p.Decision is null)) throw new IdentityProblem(409, "A proposta já foi tratada ou não pertence a este registo.");
        return proposals.Select(p => p.Id == id ? p with { Decision = decision, DecidedBy = actor.AccountId, DecidedAt = now, AppliedAmount = appliedAmount } : p).ToArray();
    }
}
