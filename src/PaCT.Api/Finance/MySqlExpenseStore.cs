using System.Data;
using System.Text.Json;
using MySql.Data.MySqlClient;
using PaCT.Api.Clients;
using PaCT.Api.Configuration;
using PaCT.Api.Infrastructure;
using PaCT.Api.Consultations;
using PaCT.Api.Identity;
using PaCT.Api.Management;
using static PaCT.Api.Management.MySqlManagementStore;

namespace PaCT.Api.Finance;

public sealed class MySqlExpenseStore(DatabaseConnectionSettings settings, IdentitySecurity security, TimeProvider time) : IExpenseStore
{
    internal static async Task Ready(MySqlConnection connection, MySqlTransaction? tx, CancellationToken ct)
    {
        await MySqlManagementStore.Ready(connection, tx, ct);
        await using var query = Query(connection, tx, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('financial_expenses','financial_expense_references','financial_expense_history','financial_expense_documents')");
        if (Convert.ToInt32(await query.ExecuteScalarAsync(ct)) != 4) throw new IdentityProblem(503, "A preparação das despesas ainda não foi concluída.");
    }
    private static Expense Decode(IdentitySecurity security, string id, byte[] bytes)
        => JsonSerializer.Deserialize<Expense>(security.Decrypt(id, "financial-expense", bytes))!;
    private async Task<Expense> Read(MySqlConnection connection, MySqlTransaction? tx, string id, CancellationToken ct)
    {
        await using var query = Query(connection, tx, "SELECT data FROM financial_expenses WHERE id=@id", ("@id", id));
        var bytes = await query.ExecuteScalarAsync(ct) as byte[] ?? throw new IdentityProblem(404, "Despesa não encontrada.");
        return Decode(security, id, bytes);
    }
    internal static async Task<List<Expense>> ReadExpenses(MySqlConnection connection, MySqlTransaction tx, IdentitySecurity security, CancellationToken ct)
    {
        var rows = new List<Expense>();
        await using (var query = Query(connection, tx, "SELECT id,data FROM financial_expenses"))
        await using (var reader = await query.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) rows.Add(Decode(security, reader.GetGuid(0).ToString("D"), (byte[])reader[1]));
        return rows;
    }
    private static async Task<HashSet<string>> CancelledEvents(MySqlConnection connection, MySqlTransaction tx, CancellationToken ct)
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        await using var query = Query(connection, tx, "SELECT id FROM group_events WHERE JSON_UNQUOTE(JSON_EXTRACT(data,'$.State'))='Cancelled'");
        await using var rows = await query.ExecuteReaderAsync(ct);
        while (await rows.ReadAsync(ct)) ids.Add(rows.GetGuid(0).ToString("D"));
        return ids;
    }
    public async Task<ExpensePage> ListAsync(string section, string? term, int page, CancellationToken ct)
    {
        if (section is not ("Unpaid" or "Paid" or "All" or "CancelledEvents") || page < 1 || term?.Length > 200) throw new IdentityProblem(400, "Revê a pesquisa de despesas.");
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct); await Ready(connection, null, ct);
        await using var tx = await connection.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var rows = await ReadExpenses(connection, tx, security, ct);
        var cancelled = section == "CancelledEvents" ? await CancelledEvents(connection, tx, ct) : null;
        await tx.CommitAsync(ct);
        var search = ManagementDirectory.Normalize(term ?? "");
        var matches = rows.Where(e => (section switch
            {
                "Paid" => e.Remaining == 0,
                "Unpaid" => e.Remaining > 0,
                "CancelledEvents" => Expenses.PendingReviews(e, cancelled!).Any(),
                _ => true
            })
            && (search.Length == 0 || ManagementDirectory.Normalize(e.Description + " " + e.SupplierName + " " + e.InvoiceNumber + " " +
                string.Join(" ", e.Lines.Select(l => l.Description + " " + l.CategoryName + " " +
                    string.Join(" ", (l.Allocations ?? []).Select(a => a.Activity?.Title + " " + a.Location))))).Contains(search)))
            .OrderByDescending(e => e.Date).ThenBy(e => e.Id, StringComparer.Ordinal).ToArray();
        return new(matches.Length, page, 8, matches.Skip((int)Math.Min(((long)page - 1) * 8, int.MaxValue)).Take(8).ToArray());
    }
    public async Task<ExpenseDetail> DetailAsync(string id, int historyPage, CancellationToken ct)
    {
        if (historyPage < 1 || historyPage > 100000) throw new IdentityProblem(400, "Página inválida.");
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct); await Ready(connection, null, ct);
        await using var tx = await connection.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var expense = await Read(connection, tx, id, ct);
        var history = new List<ExpenseRevision>();
        await using (var query = Query(connection, tx, "SELECT data FROM financial_expense_history WHERE expense_id=@id ORDER BY version DESC LIMIT 8 OFFSET @offset", ("@id", id), ("@offset", (historyPage - 1) * 8)))
        await using (var reader = await query.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) history.Add(JsonSerializer.Deserialize<ExpenseRevision>(security.Decrypt(id, "financial-expense-history", (byte[])reader[0]))!);
        await using var count = Query(connection, tx, "SELECT COUNT(*) FROM financial_expense_history WHERE expense_id=@id", ("@id", id));
        var total = Convert.ToInt32(await count.ExecuteScalarAsync(ct));
        var pending = expense.Lines.Any(line => line.Allocations?.Any(a => a.Activity?.Kind == "Event" && !a.KeptAfterCancellation) == true)
            ? Expenses.PendingReviews(expense, await CancelledEvents(connection, tx, ct)).ToArray() : [];
        await tx.CommitAsync(ct); return new(expense, total, history.ToArray(), PendingReviews: pending);
    }
    public async Task<ExpenseResult> ChangeAsync(string? id, ExpenseChange input, string author, string operation, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct);
        if (!await MySqlClientWriteLock.TryAcquireAsync(connection, ct)) throw new IdentityProblem(409, "Existe uma gravação em curso. Volta a tentar.");
        try
        {
            await using var tx = await connection.BeginTransactionAsync(ct); await Ready(connection, tx, ct);
            var result = await ChangeInTransaction(connection, tx, id, input, author, operation, ct);
            await tx.CommitAsync(ct); return result;
        }
        finally { await MySqlClientWriteLock.ReleaseAsync(connection); }
    }
    internal async Task<ExpenseResult> ChangeInTransaction(MySqlConnection connection, MySqlTransaction tx, string? id, ExpenseChange input, string author, string operation, CancellationToken ct)
        => await ClientCommands.Execute(MySqlClientStore.InTransaction(connection, tx, ct), security, operation, author, "Expense:" + id, input, time.GetUtcNow().UtcDateTime, async () =>
        {
            var previous = id is null ? null : await Read(connection, tx, id, ct);
            if (id is null && input.Action != "Save") throw new IdentityProblem(400, "Cria primeiro a despesa.");
            if (input.Lines is { Length: > 100 } || (input.Lines ?? []).Any(line => line?.Allocations is { Length: > 20 }))
                throw new IdentityProblem(400, "Revê o número de linhas e de repartições da despesa.");
            var entryId = id ?? Guid.NewGuid().ToString();
            var directories = new Dictionary<string, DirectoryEntry>();
            foreach (var directoryId in (input.Lines ?? []).Select(l => l?.CategoryId).Append(input.SupplierId).Where(s => s is not null).Distinct())
            {
                if (!Guid.TryParse(directoryId, out _)) throw new IdentityProblem(400, "Escolhe um fornecedor e categorias válidos.");
                await using var q = Query(connection, tx, "SELECT data FROM management_entries WHERE id=@id", ("@id", directoryId));
                if (await q.ExecuteScalarAsync(ct) is not byte[] bytes) throw new IdentityProblem(409, "Um fornecedor ou categoria já não está disponível. Revê a seleção.");
                directories[directoryId!] = JsonSerializer.Deserialize<DirectoryEntry>(security.Decrypt(directoryId!, "management-entry", bytes))!;
            }
            Expense expense;
            CancelledExpenseReview? review = null;
            if (input.Action == "ReviewCancelledEvent")
            {
                var change = input.CancelledEvent;
                var destinations = change?.Decision == "Reassign" ? new[] { new ExpenseAllocationInput(0, change.ActivityKind, change.ActivityId) } : [];
                var activities = await ReadActivities(connection, tx, destinations, ct);
                (expense, review) = Expenses.ReviewCancelledEvent(previous!, input, await CancelledEvents(connection, tx, ct),
                    activities.Values.SingleOrDefault(), author, time.GetUtcNow());
            }
            else
            {
                var activities = await ReadActivities(connection, tx, (input.Lines ?? []).SelectMany(line => line?.Allocations ?? []), ct);
                var locations = input.Lines?.Any(line => line?.Allocations is { Length: > 0 }) == true
                    ? await ReadLocations(connection, tx, ct) : null;
                expense = Expenses.Apply(entryId, previous, input, input.SupplierId is null ? null : directories.GetValueOrDefault(input.SupplierId),
                    directories, author, time.GetUtcNow(), activities, locations);
            }
            if (input.Document is not null)
            {
                if (input.RemoveDocument) throw new IdentityProblem(400, "Escolhe entre substituir ou retirar o documento.");
                var file = Expenses.ValidateDocument(input.Document); var documentId = Guid.NewGuid().ToString();
                expense = expense with { Document = new(documentId, file.Name, file.Type, file.Content.Length) };
            }
            var data = security.Encrypt(entryId, "financial-expense", JsonSerializer.Serialize(expense));
            var sql = previous is null ? "INSERT INTO financial_expenses(id,version,data) VALUES(@id,@version,@data)" : "UPDATE financial_expenses SET version=@version,data=@data WHERE id=@id AND version=@old";
            await using (var write = Query(connection, tx, sql, ("@id", entryId), ("@version", expense.Version), ("@data", data), ("@old", previous?.Version)))
                if (await write.ExecuteNonQueryAsync(ct) != 1) throw new IdentityProblem(409, "A despesa mudou. Volta a abri-la.");
            foreach (var reference in directories.Keys)
            {
                await using var link = Query(connection, tx, "INSERT IGNORE INTO financial_expense_references(expense_id,entry_id) VALUES(@id,@entry)", ("@id", entryId), ("@entry", reference));
                await link.ExecuteNonQueryAsync(ct);
            }
            if (input.Document is not null)
            {
                // Documents are immutable; an older revision keeps its original document.
                var bytes = security.Encrypt(expense.Document!.Id, "expense-document", input.Document.Base64);
                await using var fileWrite = Query(connection, tx, "INSERT INTO financial_expense_documents(id,expense_id,data) VALUES(@id,@expense,@data)", ("@id", expense.Document.Id), ("@expense", entryId), ("@data", bytes));
                await fileWrite.ExecuteNonQueryAsync(ct);
            }
            var revision = new ExpenseRevision(review is not null ? "Reviewed" : previous is null ? "Created" : input.Action == "Pay" ? "Paid" : "Updated", input.Reason?.Trim(), expense, review);
            await using var audit = Query(connection, tx, "INSERT INTO financial_expense_history(expense_id,version,data) VALUES(@id,@version,@data)", ("@id", entryId), ("@version", expense.Version), ("@data", security.Encrypt(entryId, "financial-expense-history", JsonSerializer.Serialize(revision))));
            await audit.ExecuteNonQueryAsync(ct);
            return new ExpenseResult(true, review is not null ? "Repartição da despesa revista." : input.Action == "Pay" ? "Pagamento da despesa registado." : previous is null ? "Despesa registada." : "Despesa atualizada.", expense);
        });
    private static async Task<Dictionary<(string Kind, string Id), ExpenseActivity>> ReadActivities(
        MySqlConnection connection, MySqlTransaction tx, IEnumerable<ExpenseAllocationInput> allocations, CancellationToken ct)
    {
        var requested = allocations.Where(a => a?.ActivityId is not null || a?.ActivityKind is not null);
        var groups = requested.Select(a =>
        {
            if (a.ActivityKind is not ("Consultation" or "Event") || !Guid.TryParse(a.ActivityId, out var id))
                throw new IdentityProblem(400, "Escolhe uma atividade válida.");
            return (Kind: a.ActivityKind, Id: id.ToString("D"));
        }).Distinct().GroupBy(a => a.Kind);
        var result = new Dictionary<(string Kind, string Id), ExpenseActivity>();
        foreach (var group in groups)
        {
            var consultation = group.Key == "Consultation";
            var table = consultation ? "consultations" : "group_events";
            var parameters = group.Select((entry, index) => ("@id" + index, (object?)entry.Id)).ToArray();
            var placeholders = string.Join(",", parameters.Select(p => p.Item1));
            await using var query = Query(connection, tx, $"SELECT data FROM {table} WHERE id IN ({placeholders})", parameters);
            await using var reader = await query.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var json = reader.GetString(0);
                var activity = consultation ? ExpenseActivities.From(JsonSerializer.Deserialize<Consultation>(json)!)
                    : ExpenseActivities.From(JsonSerializer.Deserialize<GroupEvent>(json)!);
                if (activity is not null) result[(activity.Kind, activity.Id)] = activity;
            }
        }
        return result;
    }
    private async Task<string[]> ReadLocations(MySqlConnection connection, MySqlTransaction tx, CancellationToken ct)
    {
        var data = new ConsultationData { PublishedSite = await MySqlSitePresentationStore.ReadPublished(connection, tx, security, ct) };
        await using var query = Query(connection, tx, "SELECT data FROM consultation_services");
        await using var rows = await query.ExecuteReaderAsync(ct);
        while (await rows.ReadAsync(ct)) data.Services.Add(JsonSerializer.Deserialize<ConsultationService>(rows.GetString(0))!);
        return ExpenseActivities.Locations(data);
    }

    public async Task<(ExpenseDocument Document, byte[] Content)> DocumentAsync(string id, long? version, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection(); await connection.OpenAsync(ct); await Ready(connection, null, ct);
        var expense = await Read(connection, null, id, ct);
        if (version.HasValue && version != expense.Version)
        {
            await using var history = Query(connection, null, "SELECT data FROM financial_expense_history WHERE expense_id=@id AND version=@version", ("@id", id), ("@version", version));
            var revision = await history.ExecuteScalarAsync(ct) as byte[] ?? throw new IdentityProblem(404, "Versão não encontrada.");
            expense = JsonSerializer.Deserialize<ExpenseRevision>(security.Decrypt(id, "financial-expense-history", revision))!.Expense;
        }
        var document = expense.Document ?? throw new IdentityProblem(404, "Documento não encontrado.");
        await using var query = Query(connection, null, "SELECT data FROM financial_expense_documents WHERE id=@id AND expense_id=@expense", ("@id", document.Id), ("@expense", id));
        var bytes = await query.ExecuteScalarAsync(ct) as byte[] ?? throw new IdentityProblem(404, "Documento não encontrado.");
        return (document, Convert.FromBase64String(security.Decrypt(document.Id, "expense-document", bytes)));
    }
}
