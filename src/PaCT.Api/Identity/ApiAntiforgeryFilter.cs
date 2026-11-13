using System.Security.Claims;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace PaCT.Api.Identity;

public sealed class ApiAntiforgeryFilter(IAntiforgery antiforgery) : IAsyncAuthorizationFilter
{
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        // A restored manager window must never execute under a cookie that
        // another tab has changed to a different account. Optional for existing
        // clients; this check does not replace authorization or CSRF.
        if (context.HttpContext.Request.Headers.TryGetValue("X-PaCT-Account", out var expected)
            && (expected.Count != 1 || context.HttpContext.User.Identity?.IsAuthenticated != true
                || expected[0] != context.HttpContext.User.FindFirstValue(ClaimTypes.NameIdentifier)))
        {
            context.Result = new UnauthorizedObjectResult(new ProblemDetails { Status = 401,
                Title = "A conta ativa mudou ou a sessão terminou. Volta a entrar antes de continuar." });
            return;
        }
        var method = context.HttpContext.Request.Method;
        if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method)) return;
        try { await antiforgery.ValidateRequestAsync(context.HttpContext); }
        catch (AntiforgeryValidationException)
        {
            context.Result = new BadRequestObjectResult(new ProblemDetails { Status = 400,
                Title = "A verificação de segurança do pedido expirou. Atualiza a página e volta a tentar." });
        }
    }
}
