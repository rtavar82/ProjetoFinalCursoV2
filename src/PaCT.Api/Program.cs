using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.DataProtection;
using PaCT.Api.Configuration;
using PaCT.Api.Consultations;
using PaCT.Api.Data;
using PaCT.Api.Health;
using PaCT.Api.Infrastructure;
using PaCT.Api.Identity;
using PaCT.Api.Management;
using PaCT.Api.Sharing;
using System.Text.Json;

namespace PaCT.Api;

public partial class Program
{
    public static async Task Main(string[] args)
    {
        var auditEvents = args.Contains("--audit-event-rules", StringComparer.Ordinal);
        var prepareEvents = args.Contains("--prepare-event-rules", StringComparer.Ordinal);
        const string prepareSalesOption = "--prepare-sales";
        var prepareSales = args.Contains(prepareSalesOption, StringComparer.Ordinal);
        const string prepareManagerTasksOption = "--prepare-manager-tasks";
        var prepareManagerTasks = args.Contains(prepareManagerTasksOption, StringComparer.Ordinal);
        const string prepareManagementOption = "--prepare-management";
        var prepareManagement = args.Contains(prepareManagementOption, StringComparer.Ordinal);
        const string preparePresentationOption = "--prepare-site-presentation";
        var preparePresentation = args.Contains(preparePresentationOption, StringComparer.Ordinal);
        const string preparePrivacyOption = "--prepare-privacy";
        var preparePrivacy = args.Contains(preparePrivacyOption, StringComparer.Ordinal);
        const string prepareExpensesOption = "--prepare-expenses";
        var prepareExpenses = args.Contains(prepareExpensesOption, StringComparer.Ordinal);
        const string prepareOption = "--prepare-installation";
        const string auditFinanceOption = "--audit-financial-rules";
        const string prepareFinanceOption = "--prepare-financial-rules";
        var auditFinance = args.Contains(auditFinanceOption, StringComparer.Ordinal);
        var prepareFinance = args.Contains(prepareFinanceOption, StringComparer.Ordinal);
        const string showCodeOption = "--show-installation-code";
        const string prepareInvitationsOption = "--prepare-therapist-invitations";
        const string prepareClientsOption = "--prepare-clients";
        const string prepareConsultationsOption = "--prepare-consultations";
        const string preparePasskeysOption = "--prepare-passkeys";
        const string prepareClientAccessOption = "--prepare-client-access";
        const string prepareAccountLoginOption = "--prepare-account-login";
        const string configureCatalogueOption = "--configure-approved-catalogue";
        const string prepareAudioOption = "--prepare-conversation-audio";
        var prepareAudio = args.Contains(prepareAudioOption, StringComparer.Ordinal);
        const string prepareSharingOption = "--prepare-sharing";
        var prepareSharing = args.Contains(prepareSharingOption, StringComparer.Ordinal);
        const string prepareTestimonialsOption = "--prepare-testimonials";
        const string auditProcessStagesOption = "--audit-process-states";
        const string prepareProcessStagesOption = "--prepare-process-states";
        const string prepareRequestRecoveryOption = "--prepare-request-recovery";
        const string prepareEmailOperationsOption = "--prepare-email-operations";
        var prepareRequestRecovery = args.Contains(prepareRequestRecoveryOption, StringComparer.Ordinal);
        var prepareEmailOperations = args.Contains(prepareEmailOperationsOption, StringComparer.Ordinal);
        var auditProcessStages = args.Contains(auditProcessStagesOption, StringComparer.Ordinal);
        var prepareProcessStages = args.Contains(prepareProcessStagesOption, StringComparer.Ordinal);
        var prepareTestimonials = args.Contains(prepareTestimonialsOption, StringComparer.Ordinal);
        var configureCatalogue = args.Contains(configureCatalogueOption, StringComparer.Ordinal);
        var prepareAccountLogin = args.Contains(prepareAccountLoginOption, StringComparer.Ordinal);
        var prepareClientAccess = args.Contains(prepareClientAccessOption, StringComparer.Ordinal);
        const string resetManagerFactorsOption = "--reset-manager-factors";
        var resetManagerFactors = args.Contains(resetManagerFactorsOption, StringComparer.Ordinal);
        var preparePasskeys = args.Contains(preparePasskeysOption, StringComparer.Ordinal);
        var prepareConsultations = args.Contains(prepareConsultationsOption, StringComparer.Ordinal);
        var prepare = args.Contains(prepareOption, StringComparer.Ordinal);
        var showCode = args.Contains(showCodeOption, StringComparer.Ordinal);
        var prepareInvitations = args.Contains(prepareInvitationsOption, StringComparer.Ordinal);
        var prepareClients = args.Contains(prepareClientsOption, StringComparer.Ordinal);
        var builder = WebApplication.CreateBuilder(args.Where(argument => argument != prepareManagerTasksOption && argument != prepareSalesOption && argument != prepareManagementOption && argument != prepareExpensesOption && argument != preparePresentationOption && argument != preparePrivacyOption)
            .Where(argument => argument != "--audit-event-rules" && argument != "--prepare-event-rules" && argument != auditFinanceOption && argument != prepareFinanceOption && argument != prepareOption && argument != showCodeOption && argument != prepareInvitationsOption && argument != prepareClientsOption && argument != prepareConsultationsOption && argument != preparePasskeysOption && argument != resetManagerFactorsOption && argument != prepareClientAccessOption && argument != prepareAccountLoginOption && argument != configureCatalogueOption && argument != prepareAudioOption && argument != prepareSharingOption && argument != prepareTestimonialsOption && argument != auditProcessStagesOption && argument != prepareProcessStagesOption && argument != prepareRequestRecoveryOption && argument != prepareEmailOperationsOption)
            .ToArray());

        builder.Services.AddSingleton(services =>
            DatabaseConnectionSettings.FromConfiguration(services.GetRequiredService<IConfiguration>()));
        builder.Services.AddControllers();
        builder.Logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.Warning);
        builder.Services.AddOpenApi();
        builder.Services.AddHealthChecks().AddCheck<MySqlReadinessCheck>("mysql", tags: ["ready"]);
        builder.AddAccountSecurity();
        builder.AddGoogleCalendar();
        builder.Services.AddSingleton<PaCT.Api.Consultations.MySqlConsultationStore>();
        builder.Services.AddSingleton<PaCT.Api.Consultations.IConsultationStore>(services =>
            services.GetRequiredService<PaCT.Api.Consultations.MySqlConsultationStore>());
        builder.Services.AddSingleton<PaCT.Api.Management.IManagementStore, PaCT.Api.Management.MySqlManagementStore>();
        builder.Services.AddSingleton<PaCT.Api.Management.MySqlSitePresentationStore>();
        builder.Services.AddSingleton<PaCT.Api.Management.SitePresentationImages>();
        builder.Services.AddSingleton<PrivacyStore>();
        builder.Services.AddSingleton<PaCT.Api.Finance.IExpenseStore, PaCT.Api.Finance.MySqlExpenseStore>();
        builder.Services.AddSingleton<PaCT.Api.Consultations.ConsultationPhotoStore>();
        builder.Services.AddSingleton<PaCT.Api.Consultations.ClosureMediaStore>();
        builder.Services.AddSingleton<PaCT.Api.Testimonials.ITestimonialStore, PaCT.Api.Testimonials.MySqlTestimonialStore>();
        builder.Services.AddSingleton<PaCT.Api.Testimonials.TestimonialImageStore>();
        builder.Services.AddSingleton<SharingStore>();
        builder.Services.AddSingleton<SharingMedia>();
        builder.Services.AddSingleton<SharingAgenda>();
        builder.Services.AddHostedService<PaCT.Api.Consultations.ConsultationClockWorker>();
        builder.Services.AddSingleton<PaCT.Api.Consultations.BalancePushKeys>();
        builder.Services.AddSingleton<PaCT.Api.Consultations.IBrowserPushStore, PaCT.Api.Consultations.BrowserPushStore>();
        builder.Services.AddSingleton<PaCT.Api.Consultations.IBrowserPushTransport, PaCT.Api.Consultations.BrowserPushTransport>();
        builder.Services.AddHostedService<PaCT.Api.Consultations.BalancePushWorker>();
        builder.Services.AddHostedService<PaCT.Api.Consultations.ConsultationPushWorker>();
        builder.Services.AddSingleton<ManagerTaskStore>();
        builder.Services.AddHostedService<ManagerTaskPushWorker>();
        var app = builder.Build();
        var database = app.Services.GetRequiredService<DatabaseConnectionSettings>();

        if (prepareManagerTasks || prepareExpenses || prepareManagement || preparePresentation || preparePrivacy || prepareSales || auditEvents || prepareEvents || auditFinance || prepareFinance || prepare || showCode || prepareInvitations || prepareClients || prepareConsultations || preparePasskeys || resetManagerFactors || prepareClientAccess || prepareAccountLogin || configureCatalogue || prepareAudio || prepareSharing || prepareTestimonials || auditProcessStages || prepareProcessStages || prepareRequestRecovery || prepareEmailOperations)
        {
            try
            {
                if (new[] { prepareManagerTasks, prepareExpenses, prepareManagement, preparePresentation, preparePrivacy, prepareSales, auditEvents, prepareEvents, auditFinance, prepareFinance, prepare, showCode, prepareInvitations, prepareClients, prepareConsultations, preparePasskeys, resetManagerFactors, prepareClientAccess, prepareAccountLogin, configureCatalogue, prepareAudio, prepareSharing, prepareTestimonials, auditProcessStages, prepareProcessStages, prepareRequestRecovery, prepareEmailOperations }.Count(value => value) != 1) throw new InvalidOperationException("Use one installation command at a time.");
                var secrets = app.Services.GetRequiredService<InstallationSecrets>();
                if (prepareManagerTasks)
                {
                    await ManagerTaskSchema.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(),
                        app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "prepared", module = "manager-tasks" }));
                }
                else if (prepareExpenses)
                    Console.WriteLine(JsonSerializer.Serialize(await ExpenseSchema.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None)));
                else if (prepareManagement)
                    Console.WriteLine(JsonSerializer.Serialize(await ManagementDirectorySchema.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), app.Services.GetRequiredService<IdentitySecurity>(), CancellationToken.None)));
                else if (preparePresentation)
                {
                    await SitePresentationSchema.PrepareAsync(database, CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "prepared", module = "site-presentation" }));
                }
                else if (preparePrivacy)
                {
                    await PrivacySchema.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "prepared", module = "privacy" }));
                }
                else if (prepareSales)
                    Console.WriteLine(JsonSerializer.Serialize(await FinancialSalesSchema.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None)));
                else if (auditEvents || prepareEvents)
                    Console.WriteLine(JsonSerializer.Serialize(await EventRulesPreparation.RunAsync(database, prepareEvents, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None)));
                else if (auditFinance || prepareFinance)
                    Console.WriteLine(JsonSerializer.Serialize(await FinancialPreparation.RunAsync(database, prepareFinance, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None)));
                else if (prepareEmailOperations)
                {
                    await SecurityEmailOperationsSchema.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "prepared", module = "security-email-operations", existingDataPreserved = true, sentEmails = 0 }));
                }
                else if (prepareRequestRecovery)
                {
                    await ClientCommandSchema.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "prepared", module = "request-recovery", existingDataPreserved = true, sentEmails = 0 }));
                }
                else if (auditProcessStages)
                    Console.WriteLine(JsonSerializer.Serialize(await ProcessStagePreparation.AuditAsync(database, CancellationToken.None)));
                else if (prepareProcessStages)
                    Console.WriteLine(JsonSerializer.Serialize(await ProcessStagePreparation.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None)));
                else if (prepare)
                {
                    var tables = await EnglishIdentityUpgrade.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), CancellationToken.None);
                    if (!secrets.IsPrepared && tables.Any(table => table.RowCount != 0))
                        throw new InvalidOperationException("Existing records require the original installation keys. New keys were not created.");
                    secrets.Prepare();
                    var invitationTable = await TherapistInvitationSchema.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None);
                    tables = tables.Where(table => table.Name != invitationTable.Name).Append(invitationTable).ToArray();
                    await ClientSchema.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None);
                    tables = await EnglishIdentityUpgrade.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), CancellationToken.None);
                    await PrivacySchema.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None);
                    var security = app.Services.GetRequiredService<IdentitySecurity>();
                    var measurements = new List<long>();
                    for (var index = 0; index < 3; index++)
                    {
                        var timer = System.Diagnostics.Stopwatch.StartNew();
                        _ = security.HashPassword(Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(24)));
                        measurements.Add(timer.ElapsedMilliseconds);
                    }
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "prepared", database = DatabaseConnectionSettings.ExpectedDatabaseName,
                        tables = tables.Select(table => new { name = table.Name, rowCount = table.RowCount }), importedData = false,
                        codeShown = false, passwordIterations = IdentitySecurity.PasswordIterations, medianHashMilliseconds = measurements.Order().ElementAt(1) }));
                }
                else if (prepareAudio)
                {
                    _ = secrets.SearchKey;
                    await ConversationAudioSchema.PrepareAsync(database, CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "prepared", module = "conversation-audio" }));
                }
                else if (prepareSharing)
                {
                    _ = secrets.SearchKey;
                    await app.Services.GetRequiredService<SharingStore>().PrepareAsync(CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "prepared", module = "sharing" }));
                }
                else if (prepareTestimonials)
                {
                    _ = secrets.SearchKey;
                    var created = await TestimonialSchema.PrepareAsync(database, CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "prepared", module = "testimonials", tableCreated = created,
                        existingDataPreserved = true, importedPublications = 0, sentEmails = 0 }));
                }
                else if (configureCatalogue)
                {
                    _ = secrets.SearchKey;
                    var added = await ApprovedCatalogueSetup.ApplyAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "configured", database = DatabaseConnectionSettings.ExpectedDatabaseName,
                        servicesAdded = added, existingDataPreserved = true, appointmentsCreated = 0, availabilityCreated = 0, sentEmails = 0 }));
                }
                else if (prepareAccountLogin)
                {
                    _ = secrets.SearchKey;
                    await AccountLoginSchema.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "prepared", module = "google-password-change", existingDataPreserved = true, sentEmails = 0 }));
                }
                else if (prepareClientAccess)
                {
                    _ = secrets.SearchKey;
                    await ClientAccessSchema.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "prepared", module = "client-access", existingDataPreserved = true, sentEmails = 0 }));
                }
                else if (resetManagerFactors)
                {
                    _ = secrets.SearchKey;
                    var changed = await ManagerPasskeyReset.ExecuteAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "reset", managersChanged = changed, accountsDeleted = 0, existingPasskeysPreserved = true, businessDataPreserved = true, sentEmails = 0 }));
                }
                else if (preparePasskeys)
                {
                    await PasskeyPreparation.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "prepared", module = "passkeys-stage-one", existingAccountsPreserved = true, legacyDataDeleted = false, sentEmails = 0 }));
                }
                else if (prepareConsultations)
                {
                    _ = secrets.SearchKey;
                    await ConsultationSchema.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None);
                    app.Services.GetRequiredService<PaCT.Api.Consultations.BalancePushKeys>().Prepare();
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "prepared", module = "consultations", existingDataPreserved = true, sentEmails = 0 }));
                }
                else if (prepareClients)
                {
                    _ = secrets.SearchKey;
                    await ClientSchema.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "prepared", module = "clients", existingDataPreserved = true, sentEmails = 0 }));
                }
                else if (prepareInvitations)
                {
                    _ = secrets.SearchKey;
                    var table = await TherapistInvitationSchema.PrepareAsync(database, app.Services.GetRequiredService<InstallationPaths>(), app.Services.GetRequiredService<IDataProtectionProvider>(), CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "prepared", table = table.Name, rowCount = table.RowCount, existingDataPreserved = true }));
                }
                else
                {
                    if (Console.IsOutputRedirected) throw new InvalidOperationException("Run this command in your private terminal; never redirect or share the installation code.");
                    if (await app.Services.GetRequiredService<IIdentityStore>().HasTechnicalManagerAsync(CancellationToken.None))
                        throw new InvalidOperationException("This installation already has a technical manager.");
                    Console.WriteLine("Installation code (private, never paste into a chat): " + secrets.GetSetupCode());
                }
            }
            catch (Exception)
            {
                Console.Error.WriteLine("Installation preparation was not confirmed. Check the private configuration and schema. DDL can be partial; no fallback deletion was attempted and no credentials were printed.");
                Environment.ExitCode = 1;
            }
            await app.DisposeAsync();
            return;
        }

        app.UseMiddleware<SafeApiErrors>();
        app.UseHttpsRedirection();
        app.Use(async (context, next) =>
        {
            context.Response.Headers["Referrer-Policy"] = "no-referrer";
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            context.Response.Headers["X-Frame-Options"] = "DENY";
            context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
            context.Response.Headers.CacheControl = "no-store";
            await next(context);
        });
        app.UseDefaultFiles();
        app.UseStaticFiles();
        app.UseRouting();
        app.UseAuthentication();
        app.UseRateLimiter();
        app.Use(async (context, next) =>
        {
            var endpoint = context.GetEndpoint();
            if (endpoint is null)
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }

            // Endpoint routing uses a synthetic endpoint to return 405 with its Allow header.
            if (endpoint is not RouteEndpoint && endpoint.DisplayName == "405 HTTP Method Not Supported"
                && endpoint.RequestDelegate is { } rejectMethod)
            {
                await rejectMethod(context);
                return;
            }

            await next(context);
        });
        app.UseAuthorization();

        if (app.Environment.IsDevelopment())
            app.MapOpenApi().AllowAnonymous();

        app.MapHealthChecks("/health/live", new HealthCheckOptions
        {
            Predicate = _ => false,
            ResponseWriter = HealthResponse.WriteAsync
        }).AllowAnonymous();
        app.MapHealthChecks("/health/ready", new HealthCheckOptions
        {
            Predicate = registration => registration.Tags.Contains("ready"),
            ResponseWriter = HealthResponse.WriteAsync
        }).AllowAnonymous();
        app.MapControllers();
        app.Run();
    }
}
