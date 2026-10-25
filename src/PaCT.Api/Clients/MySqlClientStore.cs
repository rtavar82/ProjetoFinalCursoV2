using System.Text.Json;
using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;
using PaCT.Api.Identity;

namespace PaCT.Api.Clients;

public sealed class MySqlClientStore(DatabaseConnectionSettings settings) : IClientStore
{
    internal static Task CreateGuestAsync(MySqlConnection connection, MySqlTransaction transaction, string id,
        PaCT.Api.Consultations.GuestSubmission raw, IdentitySecurity security, DateTime now, CancellationToken ct)
    {
        var input = PaCT.Api.Consultations.GuestConsultations.Normalize(raw);
        var fields = new Dictionary<string, byte[]> {
            ["first-name"] = security.Encrypt(id, "first-name", input.FirstName),
            ["last-name"] = security.Encrypt(id, "last-name", input.LastName),
            ["dial-code"] = security.Encrypt(id, "dial-code", input.DialCode),
            ["phone"] = security.Encrypt(id, "phone", input.Phone)
        };
        if (input.Email is not null) fields["email"] = security.Encrypt(id, "email", input.Email);
        // A declared contact is not proof of ownership of an existing ficha or account.
        var row = new StoredClient(id, new(), fields, input.Email is null ? null : security.EmailHash(input.Email),
            security.PhoneHash(input.DialCode, input.Phone), null, null, now, now, 1);
        return new Session(connection, transaction, ct).SaveClientAsync(row, true);
    }
    public async Task<T> ExecuteAsync<T>(Func<IClientSession, Task<T>> action, bool write, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        if (!write) return await action(new Session(connection, null, ct));
        await using var gate = new MySqlCommand("SELECT GET_LOCK('pact0.2_db:client-writes', 5)", connection);
        if (Convert.ToInt32(await gate.ExecuteScalarAsync(ct)) != 1) throw new IdentityProblem(409, "Há outra alteração em curso. Volta a tentar dentro de instantes.");
        try
        {
            await using var transaction = await connection.BeginTransactionAsync(ct);
            var result = await action(new Session(connection, transaction, ct));
            await transaction.CommitAsync(ct);
            return result;
        }
        catch (MySqlException error) when (error.Number == 1062) { throw new IdentityProblem(409, "O estado mudou ou os dados coincidem com outro registo. Atualiza e verifica antes de repetir."); }
        finally
        {
            await using var release = new MySqlCommand("SELECT RELEASE_LOCK('pact0.2_db:client-writes')", connection);
            await release.ExecuteScalarAsync(CancellationToken.None);
        }
    }

    private sealed class Session(MySqlConnection connection, MySqlTransaction? transaction, CancellationToken ct) : IClientSession
    {
        private MySqlCommand Command(string sql, params (string Key, object? Value)[] values)
        {
            var command = new MySqlCommand(sql, connection, transaction);
            foreach (var value in values) command.Parameters.AddWithValue(value.Key, value.Value ?? DBNull.Value);
            return command;
        }
        private async Task Execute(string sql, params (string Key, object? Value)[] values)
        { await using var command = Command(sql, values); if (await command.ExecuteNonQueryAsync(ct) != 1) throw new IdentityProblem(409, "O registo mudou entretanto. Atualiza antes de guardar."); }
        private static string Id(MySqlDataReader reader, string name) => reader.GetGuid(name).ToString("D");
        private static string? Text(MySqlDataReader reader, string name) => reader[name] is DBNull ? null : reader.GetString(name);
        private static DateTime? Date(MySqlDataReader reader, string name) => reader[name] is DBNull ? null : reader.GetDateTime(name);

        public async Task<IReadOnlyList<StoredClient>> ClientsAsync()
        {
            await using var command = Command("""
                SELECT p.*, a.id AS account_id, a.display_name, a.email_confirmed_at, a.password_hash, a.closed_at,
                  EXISTS(SELECT 1 FROM client_reviews r WHERE r.person_id=p.id AND r.status='Open') AS identity_review_pending
                FROM people p LEFT JOIN accounts a ON a.origin_person_id=p.id
                WHERE a.id IS NULL OR a.role='Client' ORDER BY p.id
                """);
            await using var reader = (MySqlDataReader)await command.ExecuteReaderAsync(ct);
            var rows = new List<StoredClient>();
            var columns = new Dictionary<string, string> { ["first-name"] = "first_name_ciphertext", ["last-name"] = "last_name_ciphertext",
                ["email"] = "email_ciphertext", ["dial-code"] = "dial_code_ciphertext", ["phone"] = "phone_ciphertext",
                ["address"] = "address_ciphertext", ["postal-code"] = "postal_code_ciphertext" };
            while (await reader.ReadAsync(ct))
            {
                var fields = columns.Where(pair => reader[pair.Value] is byte[]).ToDictionary(pair => pair.Key, pair => (byte[])reader[pair.Value]);
                var data = new ClientProfile(Locality: Text(reader, "locality"), BirthDate: Date(reader, "birth_date") is { } birth ? DateOnly.FromDateTime(birth) : null,
                    Gender: Text(reader, "gender"), ChildrenCount: reader["children_count"] is DBNull ? null : Convert.ToInt32(reader["children_count"]),
                    RelationshipStatus: Text(reader, "relationship_status"), DisplayName: Text(reader, "display_name") is { Length: > 0 } display ? display : null);
                var accountId = reader["account_id"] is DBNull ? null : Id(reader, "account_id");
                var state = accountId is null ? null : Date(reader, "closed_at") is not null ? "Closed" : Date(reader, "email_confirmed_at") is null ? "ConfirmEmail"
                    : reader["password_hash"] is DBNull ? "SetPassword" : "Active";
                rows.Add(new(Id(reader, "id"), data, fields, reader["email_hash"] as byte[], reader["phone_hash"] as byte[], accountId, state,
                    reader.GetDateTime("created_at"), reader.GetDateTime("updated_at"), reader.GetUInt64("version"), Convert.ToBoolean(reader["identity_review_pending"]) ? "Pending" : null, Convert.ToBoolean(reader["is_active"])));
            }
            return rows;
        }

        public async Task<IReadOnlyList<StoredClientName>> ClientNamesAsync(string[] ids)
        {
            if (ids.Length is < 1 or > 8 || ids.Any(id => !Guid.TryParse(id, out _))) throw new IdentityProblem(400, "Seleciona até oito fichas válidas.");
            var placeholders = ids.Select((id, index) => (Key: "@person" + index, Value: (object?)id)).ToArray();
            await using var command = Command($"""
                SELECT p.id, p.first_name_ciphertext, p.last_name_ciphertext FROM people p
                LEFT JOIN accounts a ON a.origin_person_id=p.id
                WHERE p.id IN ({string.Join(',', placeholders.Select(p => p.Key))}) AND (a.id IS NULL OR a.role='Client')
                """, placeholders);
            await using var reader = (MySqlDataReader)await command.ExecuteReaderAsync(ct);
            var rows = new List<StoredClientName>();
            while (await reader.ReadAsync(ct)) rows.Add(new(Id(reader, "id"), reader["first_name_ciphertext"] as byte[], reader["last_name_ciphertext"] as byte[]));
            return rows;
        }

        public async Task SaveClientAsync(StoredClient row, bool create)
        {
            var values = new (string, object?)[] { ("@id", row.Id), ("@first", row.PrivateData.GetValueOrDefault("first-name")), ("@last", row.PrivateData.GetValueOrDefault("last-name")),
                ("@locality", row.PublicData.Locality), ("@birth", row.PublicData.BirthDate?.ToDateTime(TimeOnly.MinValue)), ("@gender", row.PublicData.Gender),
                ("@email", row.PrivateData.GetValueOrDefault("email")), ("@emailHash", row.EmailHash), ("@dial", row.PrivateData.GetValueOrDefault("dial-code")),
                ("@phone", row.PrivateData.GetValueOrDefault("phone")), ("@phoneHash", row.PhoneHash), ("@address", row.PrivateData.GetValueOrDefault("address")),
                ("@postal", row.PrivateData.GetValueOrDefault("postal-code")), ("@children", row.PublicData.ChildrenCount), ("@relationship", row.PublicData.RelationshipStatus),
                ("@created", row.CreatedAt), ("@updated", row.UpdatedAt), ("@version", row.Version), ("@previous", row.Version - 1) };
            if (create) await Execute("""
                INSERT INTO people (id, first_name_ciphertext, last_name_ciphertext, locality, birth_date, gender,
                    email_ciphertext, email_hash, dial_code_ciphertext, phone_ciphertext, phone_hash, address_ciphertext,
                    postal_code_ciphertext, children_count, relationship_status, created_at, updated_at, version)
                VALUES (@id,@first,@last,@locality,@birth,@gender,@email,@emailHash,@dial,@phone,@phoneHash,@address,@postal,@children,@relationship,@created,@updated,@version)
                """, values);
            else await Execute("""
                UPDATE people SET first_name_ciphertext=@first,last_name_ciphertext=@last,locality=@locality,birth_date=@birth,gender=@gender,
                    email_ciphertext=@email,email_hash=@emailHash,dial_code_ciphertext=@dial,phone_ciphertext=@phone,phone_hash=@phoneHash,
                    address_ciphertext=@address,postal_code_ciphertext=@postal,children_count=@children,relationship_status=@relationship,
                    updated_at=@updated,version=@version WHERE id=@id AND version=@previous
                """, values);
            if (row.AccountId is not null)
                await Execute("UPDATE accounts SET display_name=@name,updated_at=@now,version=version+1 WHERE id=@id AND role='Client'",
                    ("@name", row.PublicData.DisplayName ?? ""), ("@now", row.UpdatedAt), ("@id", row.AccountId));
        }

        public async Task<int> OpenReviewCountAsync()
        {
            await using var command = Command("""
                SELECT COUNT(*) FROM client_reviews r WHERE r.status='Open' OR (r.status='Accepted'
                    AND r.person_id<>r.associated_person_id
                    AND EXISTS(SELECT 1 FROM people p WHERE p.id=r.person_id AND p.is_active=1)
                    AND EXISTS(SELECT 1 FROM people p WHERE p.id=r.associated_person_id AND p.is_active=1))
                """);
            return Convert.ToInt32(await command.ExecuteScalarAsync(ct));
        }

        public async Task<IReadOnlyList<ClientReview>> ReviewsAsync()
        {
            await using var command = Command("SELECT * FROM client_reviews ORDER BY created_at DESC,id");
            await using var reader = (MySqlDataReader)await command.ExecuteReaderAsync(ct);
            var rows = new List<ClientReview>();
            while (await reader.ReadAsync(ct)) rows.Add(new(Id(reader, "id"), reader.GetString("kind"), reader["person_id"] is DBNull ? null : Id(reader, "person_id"),
                (byte[])reader["proposal_ciphertext"], JsonSerializer.Deserialize<string[]>(reader.GetString("candidate_ids"))!, reader.GetString("status"),
                reader["author_id"] is DBNull ? null : Id(reader, "author_id"), reader.GetDateTime("created_at"), reader.GetUInt64("source_version"), reader.GetUInt64("version"),
                reader["decided_by"] is DBNull ? null : Id(reader, "decided_by"), Date(reader, "decided_at"), reader["associated_person_id"] is DBNull ? null : Id(reader, "associated_person_id"),
                reader["selected_fields"] is DBNull ? null : JsonSerializer.Deserialize<string[]>(reader.GetString("selected_fields"))));
            return rows;
        }
        public Task SaveReviewAsync(ClientReview r, bool create) => Execute(create ? """
            INSERT INTO client_reviews (id,kind,person_id,proposal_ciphertext,candidate_ids,status,author_id,created_at,source_version,version)
            VALUES (@id,@kind,@person,@proposal,@candidates,@status,@author,@created,@sourceVersion,@version)
            """ : """
            UPDATE client_reviews SET status=@status,person_id=@person,source_version=@sourceVersion,proposal_ciphertext=@proposal,candidate_ids=@candidates,decided_by=@decidedBy,decided_at=@decidedAt,
            associated_person_id=@associated,selected_fields=@fields,version=@version WHERE id=@id AND version=@previous AND status IN ('Open','Accepted')
            """, ("@id", r.Id), ("@kind", r.Kind), ("@person", r.PersonId), ("@proposal", r.Proposal), ("@candidates", JsonSerializer.Serialize(r.Candidates)),
            ("@status", r.Status), ("@author", r.AuthorId), ("@created", r.CreatedAt), ("@sourceVersion", r.SourceVersion), ("@version", r.Version), ("@previous", r.Version - 1),
            ("@decidedBy", r.DecidedBy), ("@decidedAt", r.DecidedAt), ("@associated", r.AssociatedPersonId), ("@fields", r.SelectedFields is null ? null : JsonSerializer.Serialize(r.SelectedFields)));

        public async Task<IReadOnlyList<ClientNote>> NotesAsync(string personId)
        {
            await using var command = Command("SELECT * FROM client_notes WHERE person_id=@person ORDER BY updated_at DESC,id", ("@person", personId));
            await using var reader = (MySqlDataReader)await command.ExecuteReaderAsync(ct);
            var rows = new List<ClientNote>();
            while (await reader.ReadAsync(ct)) rows.Add(new(Id(reader, "id"), Id(reader, "person_id"), (byte[])reader["content_ciphertext"], Id(reader, "created_by"),
                Id(reader, "updated_by"), reader.GetDateTime("created_at"), reader.GetDateTime("updated_at"), reader.GetUInt64("version")));
            return rows;
        }
        public Task SaveNoteAsync(ClientNote n, bool create) => Execute(create ? """
            INSERT INTO client_notes (id,person_id,content_ciphertext,created_by,updated_by,created_at,updated_at,version)
            VALUES (@id,@person,@content,@createdBy,@updatedBy,@created,@updated,@version)
            """ : """
            UPDATE client_notes SET content_ciphertext=@content,updated_by=@updatedBy,updated_at=@updated,version=@version
            WHERE id=@id AND person_id=@person AND version=@previous
            """, ("@id", n.Id), ("@person", n.PersonId), ("@content", n.Content), ("@createdBy", n.CreatedBy), ("@updatedBy", n.UpdatedBy),
            ("@created", n.CreatedAt), ("@updated", n.UpdatedAt), ("@version", n.Version), ("@previous", n.Version - 1));

        public Task CreateRegistrationAsync(PrivatePerson person, IdentityAccount account, EmailJob email) =>
            MySqlIdentityStore.InsertIdentityAsync(connection, transaction ?? throw new InvalidOperationException("Registration requires a transaction."), person, account, email, ct);

        public async Task ConsolidateAsync(StoredClient primary, StoredClient absorbed, DateTime now, string authorId)
        {
            if (absorbed.AccountId is not null && primary.AccountId is null)
                await Execute("""
                    UPDATE accounts SET origin_person_id=@primary,display_name=@name,phone_login_hash=@phone,link_verified_at=@now,
                        link_verified_by_account_id=@author,updated_at=@now,version=version+1
                    WHERE id=@account AND origin_person_id=@absorbed AND role='Client' AND closed_at IS NULL
                    """, ("@primary", primary.Id), ("@name", primary.PublicData.DisplayName ?? ""), ("@phone", primary.PhoneHash), ("@now", now), ("@author", authorId), ("@account", absorbed.AccountId), ("@absorbed", absorbed.Id));
            else if (absorbed.AccountId is not null)
            {
                await Execute("""
                    UPDATE accounts SET closed_at=@now,security_stamp=@stamp,updated_at=@now,version=version+1
                    WHERE id=@account AND origin_person_id=@absorbed AND role='Client' AND closed_at IS NULL
                    """, ("@now", now), ("@stamp", Guid.NewGuid().ToString()), ("@account", absorbed.AccountId), ("@absorbed", absorbed.Id));
                await using var cancel = Command("UPDATE security_emails SET state='Cancelled',updated_at=@now WHERE account_id=@account AND state='Pending'",
                    ("@now", now), ("@account", absorbed.AccountId));
                await cancel.ExecuteNonQueryAsync(ct);
            }
            if (primary.AccountId is not null)
                await Execute("UPDATE accounts SET phone_login_hash=@phone,updated_at=@now,version=version+1 WHERE id=@id AND role='Client' AND closed_at IS NULL",
                    ("@phone", primary.PhoneHash), ("@now", now), ("@id", primary.AccountId));
            await Execute("UPDATE people SET is_active=0,updated_at=@now,version=version+1 WHERE id=@id AND version=@version AND is_active=1",
                ("@now", now), ("@id", absorbed.Id), ("@version", absorbed.Version));
        }

        public async Task QueueSetupEmailAsync(IdentityAccount account, EmailJob email)
        {
            await Execute("UPDATE accounts SET security_stamp=@stamp,updated_at=@now,version=version+1 WHERE id=@id AND version=@version AND role='Client' AND password_hash IS NULL AND closed_at IS NULL",
                ("@stamp", account.SecurityStamp), ("@now", email.CreatedAt), ("@id", account.Id), ("@version", account.Version));
            await using var cancel = Command("UPDATE security_emails SET state='Cancelled',updated_at=@now WHERE account_id=@id AND state='Pending'", ("@now", email.CreatedAt), ("@id", account.Id));
            await cancel.ExecuteNonQueryAsync(ct);
            await MySqlIdentityStore.InsertEmailAsync(connection, transaction!, email, ct);
        }
    }
}
