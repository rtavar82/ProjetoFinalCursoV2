using System.Text.Json;
using PaCT.Api.Identity;

namespace PaCT.Api.Clients;

public sealed class ClientService(IClientStore store, IdentitySecurity security, IdentityService identity,
    IIdentityStore accounts, ISecurityEmailTransport transport, TimeProvider time)
{
    private DateTime Now => time.GetUtcNow().UtcDateTime;
    private DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(Now, TimeZoneInfo.FindSystemTimeZoneById("Europe/Lisbon")));
    private const string ConflictMessage = "Não foi possível concluir com os dados indicados. A situação será analisada pela gestão.";
    private static IdentityProblem Changed() => new(409, "Os dados foram alterados entretanto. Reabre a ficha e revê as alterações antes de guardar.");

    public Task<object> SearchAsync(string field, string? term, int page, CancellationToken ct) => store.ExecuteAsync<object>(async session =>
    {
        if (page is < 1 or > 100000 || field is not ("Name" or "Email" or "Phone")) throw new IdentityProblem(400, "Pesquisa inválida.");
        term = term?.Trim();
        if (!string.IsNullOrEmpty(term) && (term.Length > 256 || (field == "Name" && term.Length < 3))) throw new IdentityProblem(400, "Na pesquisa por nome, indica pelo menos três caracteres.");
        var rows = (await session.ClientsAsync()).Where(row => row.IsActive).Select(View);
        if (!string.IsNullOrEmpty(term))
        {
            var normalized = ClientValidation.NormalizeName(term);
            rows = rows.Where(row => field switch {
                "Name" => ClientValidation.NormalizeName(row.Data.FirstName + " " + row.Data.LastName).Contains(normalized, StringComparison.Ordinal),
                "Email" => string.Equals(row.Data.Email, term, StringComparison.OrdinalIgnoreCase),
                _ => ("+" + row.Data.DialCode + row.Data.Phone).Contains(new string(term.Where(char.IsAsciiDigit).ToArray()), StringComparison.Ordinal)
            });
            if (field == "Phone" && !term.Any(char.IsAsciiDigit)) throw new IdentityProblem(400, "Indica algarismos para pesquisar o telefone.");
        }
        var filtered = rows.OrderByDescending(row => row.CreatedAt).ThenBy(row => row.Id, StringComparer.Ordinal).ToArray();
        return new { total = filtered.Length, page, pageSize = 8,
            items = filtered.Skip((page - 1) * 8).Take(8).Select(row => new { row.Id, row.HasAccount, row.AccountState,
                row.IdentityReviewStatus, data = new { row.Data.FirstName, row.Data.LastName, row.Data.Locality, row.Data.Email, row.Data.Phone, row.Data.DialCode } }).ToArray() };
    }, false, ct);

    public Task<ClientView> GetAsync(string id, CancellationToken ct) => store.ExecuteAsync(async session => View(Find(await session.ClientsAsync(), id)), false, ct);

    public Task<object> NamesAsync(string[] ids, CancellationToken ct)
    {
        if (ids.Length is < 1 or > 8 || ids.Any(id => !Guid.TryParse(id, out _))) throw new IdentityProblem(400, "Seleciona até oito fichas válidas.");
        var selected = ids.Select(id => Guid.Parse(id).ToString("D")).Distinct(StringComparer.Ordinal).ToArray();
        return store.ExecuteAsync<object>(async session => (await session.ClientNamesAsync(selected)).ToDictionary(row => row.Id,
            row => string.Join(" ", new[] { row.FirstName is null ? null : security.Decrypt(row.Id, "first-name", row.FirstName),
                row.LastName is null ? null : security.Decrypt(row.Id, "last-name", row.LastName) }.Where(value => !string.IsNullOrWhiteSpace(value)))), false, ct);
    }

    public Task<object> ReviewSummaryAsync(CancellationToken ct) => store.ExecuteAsync<object>(async session =>
        new { pendingReviewCount = await session.OpenReviewCountAsync() }, false, ct);

    public Task<ClientSaveResult> SaveAsync(string? id, ProfileChange input, string authorId, bool manager, CancellationToken ct) => store.ExecuteAsync(async session =>
    {
        var all = await session.ClientsAsync();
        var previous = id is null ? null : Find(all, id);
        if (previous is not null && previous.Version != input.Version) throw Changed();
        var data = ClientValidation.Validate(input.Data, previous is null, Today, requireBirthDate: !manager);
        if (previous?.AccountId is null && data.DisplayName is not null) throw new IdentityProblem(400, "O nome público pertence à conta registada, não à ficha manual.");
        if (previous?.AccountId is not null && !string.Equals(data.Email, View(previous).Data.Email, StringComparison.OrdinalIgnoreCase))
            throw new IdentityProblem(400, "O email de entrada não pode ser substituído numa edição da ficha. É necessária a alteração segura do contacto de acesso.");
        if (!manager && previous is null) throw new IdentityProblem(403, "Não tens autorização para criar fichas de gestão.");
        var associations = (await session.ReviewsAsync()).Where(r => r.Status == "Accepted" && r.PersonId == id && id is not null).Select(r => r.AssociatedPersonId).ToArray();
        var changedIdentifiers = data;
        if (previous is not null)
        {
            var current = View(previous).Data;
            changedIdentifiers = data with {
                Email = string.Equals(current.Email, data.Email, StringComparison.OrdinalIgnoreCase) ? null : data.Email,
                Phone = current.DialCode == data.DialCode && current.Phone == data.Phone ? null : data.Phone,
                DisplayName = ClientValidation.NormalizeName(current.DisplayName ?? "") == ClientValidation.NormalizeName(data.DisplayName ?? "") ? null : data.DisplayName
            };
        }
        var candidateIds = Matches(all, changedIdentifiers, id).Where(match => !associations.Contains(match)).ToArray();
        if (candidateIds.Length > 0)
        {
            await AddReviewAsync(session, previous is null ? "Manual" : "Edit", id, data, candidateIds, authorId, previous?.Version ?? 0);
            return new ClientSaveResult(false, true, ConflictMessage);
        }
        var row = Protect(id ?? Guid.NewGuid().ToString(), data, previous);
        await session.SaveClientAsync(row, previous is null);
        return new ClientSaveResult(true, false, "Dados guardados.", View(row) with { IdentityReviewStatus = previous?.IdentityReviewStatus });
    }, true, ct);

    public Task<ClientSaveResult> RegisterAsync(ClientProfile input, CancellationToken ct)
    {
        var data = ClientValidation.ValidateRegistration(input, Today);
        var email = data.Email!;
        transport.CheckConfiguration();
        return store.ExecuteAsync(async session =>
        {
            var candidates = Matches(await session.ClientsAsync(), data, null);
            // Manager accounts never appear in the client directory, but still reserve their login email.
            var existing = await accounts.FindByEmailAsync(security.EmailHash(email), ct);
            if (existing is { Role: Roles.Client, PasswordHash: null, ClosedAt: null, PersonActive: true, LinkStatus: "Verified" })
            {
                var renewed = existing with { SecurityStamp = Guid.NewGuid().ToString() };
                await session.QueueSetupEmailAsync(renewed, identity.ConfirmationEmail(renewed, email));
                return new ClientSaveResult(true, false, "Pedido recebido. Consulta o novo email para continuar. Os links anteriores foram substituídos; não foi criada outra conta.");
            }
            if (existing is not null)
            {
                var reviewId = await AddReviewAsync(session, "Registration", null, data, candidates, null, 0);
                var token = security.ProtectAction("client-review", new(reviewId, "registration"), TimeSpan.FromHours(24));
                return new ClientSaveResult(false, true, ConflictMessage, ReviewToken: token);
            }
            if (candidates.Length > 0)
            {
                var legacy = (await session.ReviewsAsync()).FirstOrDefault(review => review.Kind == "Registration" && review.Status == "Open" && review.PersonId is null
                    && JsonSerializer.Deserialize<ReviewProposal>(security.Decrypt(review.Id, "review", review.Proposal))!.Data.Email == email);
                var created = await CreateRegistrationAsync(session, data);
                if (legacy is not null)
                    await session.SaveReviewAsync(legacy with { PersonId = created.Id, SourceVersion = created.Version,
                        Proposal = security.Encrypt(legacy.Id, "review", JsonSerializer.Serialize(new ReviewProposal(data))),
                        Candidates = candidates, Version = legacy.Version + 1 }, false);
                else await AddReviewAsync(session, "Registration", created.Id, data, candidates, null, created.Version);
                return new ClientSaveResult(true, true, "Pedido recebido. Confirma o teu email e cria a palavra-passe para usar a tua conta. A gestão irá verificar os teus dados; nenhuma ficha anterior foi associada.");
            }
            await CreateRegistrationAsync(session, data);
            return new ClientSaveResult(true, false, "Pedido recebido. Abre o email para confirmar o endereço e, depois, definir a palavra-passe. A submissão ao serviço não garante a entrega.");
        }, true, ct);
    }

    private async Task<StoredClient> CreateRegistrationAsync(IClientSession session, ClientProfile data)
    {
        var row = Protect(Guid.NewGuid().ToString(), data, null);
        var account = new IdentityAccount { Id = Guid.NewGuid().ToString(), PersonId = row.Id, Role = Roles.Client,
            DisplayName = data.DisplayName ?? "", PasswordHash = null, SecurityStamp = Guid.NewGuid().ToString(),
            EmailHash = row.EmailHash!, EmailCiphertext = row.PrivateData["email"], CreatedAt = row.CreatedAt };
        var person = new PrivatePerson(row.Id, row.PrivateData.GetValueOrDefault("first-name"), row.PrivateData.GetValueOrDefault("last-name"),
            data.Locality, account.EmailCiphertext, account.EmailHash, row.CreatedAt);
        await session.CreateRegistrationAsync(person, account, identity.ConfirmationEmail(account, data.Email!));
        row = row with { AccountId = account.Id, AccountState = "ConfirmEmail", Version = 2 };
        await session.SaveClientAsync(row, false);
        return row;
    }

    public Task<object> RegistrationReviewAsync(string token, CancellationToken ct)
    {
        if (!security.TryReadAction("client-review", token, out var proof, out var expires) || expires <= time.GetUtcNow()) throw new IdentityProblem(400, "Esta consulta de estado expirou. Não dá acesso a uma conta.");
        return store.ExecuteAsync<object>(async session =>
        {
            var review = (await session.ReviewsAsync()).SingleOrDefault(r => r.Id == proof.AccountId && r.Kind == "Registration")
                ?? throw new IdentityProblem(404, "Pedido não encontrado.");
            return new { review.Status, message = review.Status == "Rejected" ? "Não foi possível concluir este pedido com os dados indicados. Contacta a gestão se precisares de ajuda."
                : review.Status == "Accepted" ? "A gestão concluiu a revisão. Consulta o email para confirmar o endereço e criar a palavra-passe."
                : "Não foi possível concluir com os dados indicados. A situação aguarda análise pela gestão." };
        }, false, ct);
    }

    private async Task<string> AddReviewAsync(IClientSession session, string kind, string? personId, ClientProfile data, string[] candidates, string? authorId, ulong sourceVersion)
    {
        var json = JsonSerializer.Serialize(new ReviewProposal(data));
        foreach (var current in (await session.ReviewsAsync()).Where(r => r.Status == "Open" && r.Kind == kind && r.PersonId == personId))
            if (security.Decrypt(current.Id, "review", current.Proposal) == json) return current.Id;
        var id = Guid.NewGuid().ToString();
        await session.SaveReviewAsync(new(id, kind, personId, security.Encrypt(id, "review", json), candidates, "Open", authorId, Now, sourceVersion), true);
        return id;
    }

    public Task<object> ReviewsAsync(string? personId, bool manager, CancellationToken ct) => store.ExecuteAsync<object>(async session =>
    {
        var all = await session.ClientsAsync();
        return (await session.ReviewsAsync()).Where(r => manager ? r.Status == "Open" || NeedsConsolidation(r, all) : r.PersonId == personId)
            .OrderByDescending(r => r.CreatedAt).ThenBy(r => r.Id, StringComparer.Ordinal).Select(r => manager ? (object)new {
                r.Id, r.Kind, r.PersonId, r.CreatedAt, r.Version, needsConsolidation = NeedsConsolidation(r, all), proposal = JsonSerializer.Deserialize<ReviewProposal>(security.Decrypt(r.Id, "review", r.Proposal))!.Data,
                candidates = all.Where(p => p.IsActive && r.Candidates.Contains(p.Id)).Select(View).ToArray(), source = all.Where(p => p.IsActive && p.Id == r.PersonId).Select(View).FirstOrDefault()
            } : new { r.Id, r.CreatedAt, r.Status, message = r.Status == "Rejected" ? (r.Kind == "Registration" ? "A gestão decidiu manter as fichas separadas. A tua conta continua disponível, sem acesso a dados anteriores." : "Não foi possível guardar os dados propostos.") : r.Status == "Accepted" ? "A gestão concluiu a revisão dos dados." : "Os teus dados aguardam verificação pela gestão. Podes continuar a usar a tua conta." }).ToArray();
    }, false, ct);

    public Task<ClientSaveResult> DecideAsync(string id, ReviewDecision decision, string authorId, CancellationToken ct) => store.ExecuteAsync(async session =>
    {
        var review = (await session.ReviewsAsync()).SingleOrDefault(r => r.Id == id) ?? throw new IdentityProblem(404, "Ocorrência não encontrada.");
        var all = await session.ClientsAsync();
        if ((review.Status != "Open" && !NeedsConsolidation(review, all)) || review.Version != decision.Version) throw Changed();
        var source = review.PersonId is null ? null : Find(all, review.PersonId);
        if (!decision.Accept)
        {
            if (review.Status != "Open") throw new IdentityProblem(409, "Esta identidade já foi aprovada. Conclui a consolidação das fichas.");
            await session.SaveReviewAsync(review with { Status = "Rejected", DecidedBy = authorId, DecidedAt = Now, Version = review.Version + 1 }, false);
            return new ClientSaveResult(true, false, "Proposta rejeitada. Os dados existentes foram preservados.");
        }
        if (source is not null && source.Version != (review.Kind == "Registration" || review.Status == "Accepted" ? decision.SourceVersion : review.SourceVersion)) throw Changed();
        if (decision.CandidateId is null || !review.Candidates.Contains(decision.CandidateId)) throw new IdentityProblem(400, "Escolhe a ficha da mesma pessoa.");
        var candidate = Find(all, decision.CandidateId);
        if (candidate.Id == source?.Id) throw new IdentityProblem(400, "Escolhe duas fichas diferentes.");
        if (candidate.Version != decision.CandidateVersion) throw Changed();
        var proposal = JsonSerializer.Deserialize<ReviewProposal>(security.Decrypt(review.Id, "review", review.Proposal))!.Data;
        if (review.Kind == "Registration")
        {
            var existing = await accounts.FindByEmailAsync(security.EmailHash(proposal.Email!), ct);
            if (existing is not null && existing.PersonId != source?.Id)
                throw new IdentityProblem(409, "Este email já permite aceder a uma conta. Não é possível criar outra nem unir credenciais; o titular deve usar a conta existente.");
        }
        var fields = decision.SelectedFields ?? [];
        var retained = decision.PrimaryPersonId is null || decision.PrimaryPersonId == candidate.Id ? candidate
            : source is not null && decision.PrimaryPersonId == source.Id ? source
            : throw new IdentityProblem(400, "A ficha principal deve ser uma das duas fichas comparadas.");
        var donor = retained.Id == source?.Id ? View(candidate).Data : source is not null ? View(source).Data : proposal;
        var selected = ClientValidation.Select(View(retained).Data, donor, fields);
        selected = ClientValidation.Validate(selected, review.Kind == "Manual", Today);
        if (Matches(all, selected, source?.Id).Any(match => match != candidate.Id)) throw new IdentityProblem(409, "Há outra coincidência que também precisa de revisão. Os dados não foram aplicados.");
        if (review.Kind == "Registration" && source is null) source = await CreateRegistrationAsync(session, selected);
        var primary = decision.PrimaryPersonId is null || decision.PrimaryPersonId == candidate.Id ? candidate
            : source is not null && decision.PrimaryPersonId == source.Id ? source
            : throw new IdentityProblem(400, "A ficha principal deve ser uma das duas fichas comparadas.");
        var absorbed = source is null ? null : primary.Id == source.Id ? candidate : source;
        var access = primary.AccountId ?? absorbed?.AccountId;
        if (access is not null)
        {
            var account = await accounts.FindAsync(access, ct) ?? throw Changed();
            if (account.ClosedAt is not null || !security.EmailHash(selected.Email ?? "").SequenceEqual(account.EmailHash))
                throw new IdentityProblem(409, "O email final tem de corresponder à conta de acesso que será mantida. Alterar o email exige confirmação pelo titular.");
        }
        var saved = Protect(primary.Id, selected, primary);
        await session.SaveClientAsync(saved, false);
        if (absorbed is not null)
        {
            await session.ConsolidateAsync(saved, absorbed, Now, authorId);
            foreach (var pending in (await session.ReviewsAsync()).Where(r => r.Id != review.Id && r.Status == "Open"
                && (r.PersonId == absorbed.Id || r.Candidates.Contains(absorbed.Id))))
            {
                var candidates = pending.Candidates.Select(candidateId => candidateId == absorbed.Id ? saved.Id : candidateId)
                    .Where(candidateId => candidateId != pending.PersonId).Distinct().ToArray();
                var superseded = pending.PersonId == absorbed.Id || candidates.Length == 0;
                await session.SaveReviewAsync(pending with { Candidates = candidates,
                    Status = superseded ? "Rejected" : "Open", DecidedBy = superseded ? authorId : null,
                    DecidedAt = superseded ? Now : null, Version = pending.Version + 1 }, false);
            }
        }
        if (review.Status == "Accepted")
        {
            var auditId = Guid.NewGuid().ToString();
            review = new ClientReview(auditId, review.Kind, saved.Id,
                security.Encrypt(auditId, "review", JsonSerializer.Serialize(new ReviewProposal(selected))),
                [absorbed!.Id], "Open", authorId, Now, saved.Version);
            await session.SaveReviewAsync(review, true);
        }
        await session.SaveReviewAsync(review with { Status = "Accepted", DecidedBy = authorId, DecidedAt = Now,
            PersonId = saved.Id, AssociatedPersonId = absorbed?.Id, SelectedFields = fields, Version = review.Version + 1 }, false);
        var refreshed = Find(await session.ClientsAsync(), saved.Id);
        return new ClientSaveResult(true, false, "Perfis consolidados numa única ficha ativa. Os conteúdos e movimentos anteriores conservam a sua origem e não foram transferidos.", View(refreshed));
    }, true, ct);

    public Task<object> NotesAsync(string id, int page, CancellationToken ct) => store.ExecuteAsync<object>(async session =>
    {
        _ = Find(await session.ClientsAsync(), id);
        if (page < 1 || page > 100000) throw new IdentityProblem(400, "Página inválida.");
        var notes = (await session.NotesAsync(id)).OrderByDescending(n => n.UpdatedAt).ThenBy(n => n.Id, StringComparer.Ordinal).ToArray();
        return new { total = notes.Length, page, pageSize = 8, items = notes.Skip((page - 1) * 8).Take(8).Select(n => new {
            n.Id, n.CreatedAt, n.UpdatedAt, n.Version, content = JsonSerializer.Deserialize<NoteChange>(security.Decrypt(n.Id, "private-note", n.Content))
        }).ToArray() };
    }, false, ct);

    public Task<bool> SaveNoteAsync(string personId, string? id, NoteChange input, string authorId, CancellationToken ct) => store.ExecuteAsync(async session =>
    {
        _ = Find(await session.ClientsAsync(), personId);
        var title = IdentityValidation.Required(input.Title, 200, "o título da nota");
        var text = IdentityValidation.Required(input.Text, 8000, "o texto da nota");
        var previous = id is null ? null : (await session.NotesAsync(personId)).SingleOrDefault(n => n.Id == id) ?? throw new IdentityProblem(404, "Nota não encontrada.");
        if (previous is not null && previous.Version != input.Version) throw Changed();
        id ??= Guid.NewGuid().ToString();
        await session.SaveNoteAsync(new(id, personId, security.Encrypt(id, "private-note", JsonSerializer.Serialize(new NoteChange(title, text))),
            previous?.CreatedBy ?? authorId, authorId, previous?.CreatedAt ?? Now, Now, (previous?.Version ?? 0) + 1), previous is null);
        return true;
    }, true, ct);

    private static bool NeedsConsolidation(ClientReview review, IReadOnlyList<StoredClient> all) => review.Status == "Accepted"
        && review.PersonId != review.AssociatedPersonId && all.Any(row => row.Id == review.PersonId && row.IsActive)
        && all.Any(row => row.Id == review.AssociatedPersonId && row.IsActive);
    private static StoredClient Find(IReadOnlyList<StoredClient> all, string id) => all.SingleOrDefault(row => row.Id == id && row.IsActive) ?? throw new IdentityProblem(404, "Ficha não encontrada.");
    private string[] Matches(IReadOnlyList<StoredClient> all, ClientProfile data, string? except)
    {
        var email = data.Email is null ? null : security.EmailHash(data.Email);
        var phone = data.Phone is null ? null : security.PhoneHash(data.DialCode!, data.Phone);
        return all.Where(row => row.IsActive && row.Id != except).Where(row => email is not null && row.EmailHash is not null && email.SequenceEqual(row.EmailHash)
            || phone is not null && row.PhoneHash is not null && phone.SequenceEqual(row.PhoneHash)
            || data.DisplayName is not null && row.PublicData.DisplayName is not null
                && ClientValidation.NormalizeName(data.DisplayName) == ClientValidation.NormalizeName(row.PublicData.DisplayName)).Select(row => row.Id).ToArray();
    }

    internal ClientView View(StoredClient row)
    {
        string? Read(string field) => row.PrivateData.TryGetValue(field, out var value) ? security.Decrypt(row.Id, field, value) : null;
        var data = row.PublicData with { FirstName = Read("first-name"), LastName = Read("last-name"), Email = Read("email"),
            DialCode = Read("dial-code"), Phone = Read("phone"), Address = Read("address"), PostalCode = Read("postal-code") };
        return new(row.Id, data, row.AccountId is not null, row.AccountState, data.BirthDate is not null && data.Gender is not null && data.Locality is not null,
            row.CreatedAt, row.UpdatedAt, row.Version, row.IdentityReviewStatus);
    }
    private StoredClient Protect(string id, ClientProfile data, StoredClient? previous)
    {
        var now = Now;
        var fields = new Dictionary<string, byte[]>();
        void Put(string field, string? value) { if (value is not null) fields[field] = security.Encrypt(id, field, value); }
        Put("first-name", data.FirstName); Put("last-name", data.LastName); Put("email", data.Email); Put("dial-code", data.DialCode);
        Put("phone", data.Phone); Put("address", data.Address); Put("postal-code", data.PostalCode);
        var publicData = data with { FirstName = null, LastName = null, Email = null, DialCode = null, Phone = null, Address = null, PostalCode = null };
        return new(id, publicData, fields, data.Email is null ? null : security.EmailHash(data.Email),
            data.Phone is null ? null : security.PhoneHash(data.DialCode!, data.Phone), previous?.AccountId, previous?.AccountState,
            previous?.CreatedAt ?? now, now, previous is null ? 1 : previous.Version + 1);
    }
}
