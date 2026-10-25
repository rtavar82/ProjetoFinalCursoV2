using Microsoft.AspNetCore.Mvc;
using PaCT.Api.Identity;

namespace PaCT.Api.Infrastructure;

public sealed class SafeApiErrors(RequestDelegate next, ILogger<SafeApiErrors> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            if (!context.Response.HasStarted)
                context.Response.StatusCode = 499;
        }
        catch (IdentityProblem error) when (!context.Response.HasStarted)
        {
            context.Response.Clear();
            context.Response.StatusCode = error.Status;
            context.Response.Headers.CacheControl = "no-store";
            if (error.Status == 429 && error.RetryAfterSeconds is > 0)
                context.Response.Headers.RetryAfter = error.RetryAfterSeconds.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
            await context.Response.WriteAsJsonAsync(new ProblemDetails { Status = error.Status, Title = error.Message }, cancellationToken: context.RequestAborted);
        }
        catch (Exception error) when (!context.Response.HasStarted)
        {
            logger.LogError("API request failed: type={ErrorType}; requestId={RequestId}", error.GetType().Name, context.TraceIdentifier);
            context.Response.Clear();
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            context.Response.Headers.CacheControl = "no-store";
            try
            {
                await context.Response.WriteAsJsonAsync(new ProblemDetails
                {
                    Status = StatusCodes.Status500InternalServerError,
                    Title = "Não foi possível concluir o pedido.",
                    Detail = "Tenta novamente dentro de instantes. Não foi emitida uma confirmação de sucesso.",
                    Extensions = { ["requestId"] = context.TraceIdentifier }
                }, options: null, contentType: "application/problem+json", cancellationToken: context.RequestAborted);
            }
            catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
            {
                if (!context.Response.HasStarted)
                    context.Response.StatusCode = 499;
            }
        }
    }
}

