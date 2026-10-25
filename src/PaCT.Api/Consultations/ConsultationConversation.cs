using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public sealed record ConversationPage(Consultation Consultation, ConsultationMessage[] Messages, string[] ReadIds,
    int Unread, long LatestSequence, bool HasOlder);

public static class ConsultationConversation
{
    public static ConversationPage Page(ConsultationData data, string id, ConsultationActor actor, long? before)
    {
        var c = Authorized(data, id, actor);
        var messages = data.Messages.Where(m => m.ConsultationId == id).ToArray();
        var page = messages.Where(m => before is null || m.Sequence < before).OrderByDescending(m => m.Sequence).Take(20).OrderBy(m => m.Sequence).ToArray();
        return new(c, page, data.MessageReads.Where(r => r.AccountId == actor.AccountId).Select(r => r.MessageId).ToArray(),
            messages.Count(m => Unread(data, m, actor)), messages.Select(m => m.Sequence).DefaultIfEmpty().Max(),
            page.Length > 0 && messages.Any(m => m.Sequence < page[0].Sequence));
    }
    public static Consultation Authorized(ConsultationData data, string? id, ConsultationActor actor)
    {
        var c = data.Consultations.SingleOrDefault(c => c.Id == id && (actor.IsManager || c.PersonId == actor.PersonId))
            ?? throw new IdentityProblem(404, "Consulta não encontrada.");
        if (c.State != "Performed" || c.ClosedAt is null) throw new IdentityProblem(409, "O acompanhamento fica disponível após a consulta realizada.");
        return c;
    }

    public static bool Unread(ConsultationData data, ConsultationMessage message, ConsultationActor actor) =>
        message.AuthorIsManager != actor.IsManager && !data.MessageReads.Any(r => r.MessageId == message.Id && r.AccountId == actor.AccountId);

    public static ConsultationResult Apply(ConsultationData data, ConsultationCommand input, ConsultationActor actor,
        DateTimeOffset now, Func<string, string, string, string> encrypt)
    {
        var c = Authorized(data, input.Id, actor);
        if (input.Action == "ReadMessages")
        {
            var ids = input.MessageIds;
            if (ids is null || ids.Length is < 1 or > 20 || ids.Distinct().Count() != ids.Length || ids.Any(id => !Guid.TryParse(id, out _)))
                throw new IdentityProblem(400, "Seleciona até 20 mensagens apresentadas.");
            var messages = ids.Select(id => data.Messages.SingleOrDefault(m => m.Id == id && m.ConsultationId == c.Id && m.AuthorIsManager != actor.IsManager)
                ?? throw new IdentityProblem(404, "Mensagem não encontrada.")).ToArray();
            foreach (var message in messages.Where(m => Unread(data, m, actor)))
            {
                data.MessageReads.Add(new(Guid.NewGuid().ToString(), message.Id, actor.AccountId, now));
                for (var i = 0; i < data.Notices.Count; i++)
                    if (data.Notices[i].Kind == "FollowupMessage:" + message.Id && (actor.IsManager ? data.Notices[i].PersonId is null : data.Notices[i].PersonId == actor.PersonId))
                        data.Notices[i] = data.Notices[i] with { ReadAt = data.Notices[i].ReadAt ?? now };
            }
            return new(c.Id, "Mensagens marcadas como lidas.");
        }
        if (input.Action is "BlockConversation" or "ReopenConversation" && !actor.IsManager)
            throw new IdentityProblem(403, "Esta ação não está disponível.");
        if (input.ConversationVersion != c.ConversationVersion)
            throw new IdentityProblem(409, "A conversa mudou. Consulta o estado atual antes de enviar.");
        if (input.Action == "SendMessage")
        {
            if (c.ConversationBlocked) throw new IdentityProblem(409, "A conversa está encerrada para novas mensagens.");
            if (input.PhotoIds is { Length: > 0 }) throw new IdentityProblem(400, "Envia apenas texto nesta conversa.");
            if (string.IsNullOrWhiteSpace(input.MessageText) || input.MessageText.Length > 8000 || input.MessageText.Any(ch => char.IsControl(ch) && ch is not ('\r' or '\n' or '\t')))
                throw new IdentityProblem(400, "Escreve uma mensagem até 8000 caracteres.");
            var sequence = data.Messages.Where(m => m.ConsultationId == c.Id).Select(m => m.Sequence).DefaultIfEmpty().Max() + 1;
            data.Messages.Add(new(input.OperationId, c.Id, actor.AccountId, actor.IsManager, sequence, now,
                encrypt(input.OperationId, "message", input.MessageText)));
            data.Notices.Add(new(Guid.NewGuid().ToString(), actor.IsManager ? c.PersonId : null, c.Id, "FollowupMessage:" + input.OperationId, now, null));
            return new(input.OperationId, "Mensagem enviada.");
        }
        var blocked = input.Action == "BlockConversation";
        if (blocked == c.ConversationBlocked) throw new IdentityProblem(409, "A conversa já se encontra nesse estado.");
        data.Consultations[data.Consultations.FindIndex(x => x.Id == c.Id)] = c with
        {
            ConversationBlocked = blocked, ConversationVersion = c.ConversationVersion + 1,
            ConversationHistory = [..c.ConversationHistory, new(actor.AccountId, blocked, c.ConversationVersion + 1, now)]
        };
        return new(c.Id, blocked ? "Conversa encerrada para novas mensagens." : "Conversa reaberta.");
    }
}
