using PaCT.Api.Identity;

namespace PaCT.Api.Consultations;

public sealed record ConversationTarget(string Id, string PersonId, long ConversationVersion, bool ConversationBlocked, bool IsParticipation = false);
public sealed record ConversationPage(ConversationTarget Consultation, ConsultationMessage[] Messages, string[] ReadIds,
    int Unread, long LatestSequence, bool HasOlder);

public static class ConsultationConversation
{
    internal const int MaxReplyReadIds = 1000;

    public static ConversationPage Page(ConsultationData data, string id, ConsultationActor actor, long? before)
    {
        var c = Authorized(data, id, actor);
        var messages = data.Messages.Where(m => m.TargetId == id).ToArray();
        var page = messages.Where(m => before is null || m.Sequence < before).OrderByDescending(m => m.Sequence).Take(20).OrderBy(m => m.Sequence).ToArray();
        return new(c, page, data.MessageReads.Where(r => actor.IsManager || r.AccountId == actor.AccountId || data.ClientReadOwners.GetValueOrDefault(r.AccountId) == actor.PersonId).Select(r => r.MessageId).ToArray(),
            messages.Count(m => Unread(data, m, actor)), messages.Select(m => m.Sequence).DefaultIfEmpty().Max(),
            page.Length > 0 && messages.Any(m => m.Sequence < page[0].Sequence));
    }
    public static ConversationTarget Authorized(ConsultationData data, string? id, ConsultationActor actor)
    {
        if (data.Consultations.SingleOrDefault(c => c.Id == id && (actor.IsManager || c.PersonId == actor.PersonId)) is { } c)
        {
            if (c.State != "Performed" || c.ClosedAt is null) throw new IdentityProblem(409, "O acompanhamento fica disponível após a consulta realizada.");
            return new(c.Id, c.PersonId, c.ConversationVersion, c.ConversationBlocked);
        }
        var p = data.Participations.SingleOrDefault(p => p.Id == id && (actor.IsManager || p.PersonId == actor.PersonId));
        if (p is null || p.PersonId is null) throw new IdentityProblem(404, "Acompanhamento não encontrado.");
        if (p.Attendance != "Performed") throw new IdentityProblem(409, "O acompanhamento fica disponível após o fecho individual da presença.");
        return new(p.Id, p.PersonId, p.ConversationVersion, p.ConversationBlocked, true);
    }
    internal static string? VisibleVideo(ConsultationData data, string targetId, string messageId, ConsultationActor actor)
    {
        var target = Authorized(data, targetId, actor);
        return data.Messages.SingleOrDefault(m => m.Id == messageId && m.TargetId == target.Id)?.VideoId;
    }

    public static void MarkPresented(ConsultationData data, Consultation c, string[]? ids, ConsultationActor actor, DateTimeOffset now, int maximum = 20)
        => MarkPresented(data, new ConversationTarget(c.Id, c.PersonId, c.ConversationVersion, c.ConversationBlocked), ids, actor, now, maximum);

    public static bool Unread(ConsultationData data, ConsultationMessage message, ConsultationActor actor) =>
        message.AuthorIsManager != actor.IsManager && !data.MessageReads.Any(r => r.MessageId == message.Id && (actor.IsManager || r.AccountId == actor.AccountId || data.ClientReadOwners.GetValueOrDefault(r.AccountId) == actor.PersonId));

    public static void MarkPresented(ConsultationData data, ConversationTarget c, string[]? ids, ConsultationActor actor, DateTimeOffset now, int maximum = 20)
    {
        if (ids is null || ids.Length < 1 || ids.Length > maximum || ids.Distinct().Count() != ids.Length || ids.Any(id => !Guid.TryParse(id, out _)))
            throw new IdentityProblem(400, "Seleciona mensagens apresentadas nesta conversa.");
        var messages = ids.Select(id => data.Messages.SingleOrDefault(m => m.Id == id && m.TargetId == c.Id && m.AuthorIsManager != actor.IsManager)
            ?? throw new IdentityProblem(404, "Mensagem não encontrada.")).ToArray();
        foreach (var message in messages.Where(m => Unread(data, m, actor)))
        {
            data.MessageReads.Add(new(Guid.NewGuid().ToString(), message.Id, actor.AccountId, now));
            for (var j = 0; j < data.EventNotices.Count; j++)
                if (data.EventNotices[j].Kind == "FollowupMessage:" + message.Id)
                    data.EventNotices[j] = data.EventNotices[j] with { ReadAt = data.EventNotices[j].ReadAt ?? now };
            for (var i = 0; i < data.Notices.Count; i++)
                if (data.Notices[i].Kind == "FollowupMessage:" + message.Id && (actor.IsManager ? data.Notices[i].PersonId is null : data.Notices[i].PersonId == actor.PersonId))
                    data.Notices[i] = data.Notices[i] with { ReadAt = data.Notices[i].ReadAt ?? now };
        }
    }


    public static ConsultationResult Apply(ConsultationData data, ConsultationCommand input, ConsultationActor actor,
        DateTimeOffset now, Func<string, string, string, string> encrypt)
    {
        var c = Authorized(data, input.Id, actor);
        if (input.Action == "ReadMessages")
        {
            MarkPresented(data, c, input.MessageIds, actor, now);
            return new(c.Id, "Mensagens marcadas como lidas.");
        }
        if (input.Action is "BlockConversation" or "ReopenConversation" && !actor.IsManager)
            throw new IdentityProblem(403, "Esta ação não está disponível.");
        if (input.ConversationVersion != c.ConversationVersion)
            throw new IdentityProblem(409, "A conversa mudou. Consulta o estado atual antes de enviar.");
        if (input.Action == "SendMessage")
        {
            if (c.ConversationBlocked) throw new IdentityProblem(409, "A conversa está encerrada para novas mensagens.");
            var photoIds = input.PhotoIds ?? [];
            if (photoIds.Length > 0 && !actor.IsManager) throw new IdentityProblem(403, "O envio de imagens nesta conversa pertence à gestão.");
            if (photoIds.Length > 20 || photoIds.Distinct(StringComparer.Ordinal).Count() != photoIds.Length || photoIds.Any(id => !Guid.TryParse(id, out _)))
                throw new IdentityProblem(400, "Seleciona até 20 fotografias diferentes.");
            if (input.MessageAudioType is not null && !actor.IsManager) throw new IdentityProblem(403, "O envio de áudio nesta conversa pertence à gestão.");
            if (input.MessageAudioType is not null && !PaCT.Api.Infrastructure.AudioAttachment.IsAudio(input.MessageAudioType)) throw new IdentityProblem(400, "O formato do áudio não é válido.");
            if (input.MessageVideoId is not null && !actor.IsManager) throw new IdentityProblem(403, "O envio de vídeo nesta conversa pertence à gestão.");
            if (input.MessageVideoId is not null && !Guid.TryParseExact(input.MessageVideoId, "D", out _))
                throw new IdentityProblem(400, "O vídeo não é válido.");
            var text = input.MessageText ?? "";
            if (string.IsNullOrWhiteSpace(text) && photoIds.Length == 0 && input.MessageAudioType is null && input.MessageVideoId is null || text.Length > 8000 || text.Any(ch => char.IsControl(ch) && ch is not ('\r' or '\n' or '\t')))
                throw new IdentityProblem(400, "Escreve uma mensagem até 8000 caracteres ou seleciona um anexo permitido.");
            var sequence = data.Messages.Where(m => m.TargetId == c.Id).Select(m => m.Sequence).DefaultIfEmpty().Max() + 1;
            var message = new ConsultationMessage(input.OperationId, c.IsParticipation ? null : c.Id, actor.AccountId, actor.IsManager, sequence, now,
                encrypt(input.OperationId, "message", text), photoIds.Length > 0 ? photoIds : null, c.IsParticipation ? c.Id : null, input.MessageAudioType, input.MessageVideoId?.ToLowerInvariant());
            if (input.MessageIds is { Length: > 0 })
            {
                if (!actor.IsManager) throw new IdentityProblem(403, "A leitura por resposta pertence à gestão.");
                MarkPresented(data, c, input.MessageIds, actor, now, MaxReplyReadIds);
            }
            data.Messages.Add(message);
            if (c.IsParticipation)
            {
                var participant = data.Participations.Single(p => p.Id == c.Id);
                var ev = data.Events.Single(e => e.Id == participant.EventId);
                data.EventNotices.Add(new(Guid.NewGuid().ToString(), ev.Id, c.Id, actor.IsManager ? c.PersonId : null,
                    "FollowupMessage:" + input.OperationId, ev.ScheduleVersion, now, null, PushState: "Pending"));
            }
            else data.Notices.Add(new(Guid.NewGuid().ToString(), actor.IsManager ? c.PersonId : null, c.Id, "FollowupMessage:" + input.OperationId, now, null, PushState: "Pending"));
            return new(input.OperationId, "Mensagem enviada.");
        }
        var blocked = input.Action == "BlockConversation";
        if (blocked == c.ConversationBlocked) throw new IdentityProblem(409, "A conversa já se encontra nesse estado.");
        if (c.IsParticipation)
        {
            var index = data.Participations.FindIndex(p => p.Id == c.Id); var p = data.Participations[index];
            data.Participations[index] = p with { ConversationBlocked = blocked, ConversationVersion = c.ConversationVersion + 1,
                ConversationHistory = [..p.ConversationHistory ?? [], new(actor.AccountId, blocked, c.ConversationVersion + 1, now)] };
        }
        else
        {
            var index = data.Consultations.FindIndex(x => x.Id == c.Id); var current = data.Consultations[index];
            data.Consultations[index] = current with { ConversationBlocked = blocked, ConversationVersion = c.ConversationVersion + 1,
                ConversationHistory = [..current.ConversationHistory, new(actor.AccountId, blocked, c.ConversationVersion + 1, now)] };
        }
        return new(c.Id, blocked ? "Conversa encerrada para novas mensagens." : "Conversa reaberta.");
    }
}
