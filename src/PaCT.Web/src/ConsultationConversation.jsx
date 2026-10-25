import { useCallback, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import useClosureDraft from './useClosureDraft'
import InformationCard from './InformationCard'
import { agendaDate } from './agendaTime'
import styles from './ConsultationConversation.module.css'

export default function ConsultationConversation({ id, title, manager = false }) {
  const [before, setBefore] = useState(null)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef(null)
  const read = useCallback(signal => apiRequest(`consultations/${id}/messages`, undefined, { signal }), [id])
  const readOlder = useCallback(signal => apiRequest(`consultations/${id}/messages?before=${before}`, undefined, { signal }), [id, before])
  const conversation = useLiveResource('consultationMessages', `messages:${id}:latest`, read)
  const older = useLiveResource('consultationMessages', `messages:${id}:${before}`, readOlder, !!before)
  const value = conversation.data
  const shown = before ? older.data : value
  async function decide(command, retry = false) {
    if (busy || !navigator.onLine) { if (!navigator.onLine) setError('Sem ligação. Volta a tentar quando tiveres rede.'); return }
    if (pending.current && !retry) return
    const input = retry ? pending.current : { ...command, id, operationId: crypto.randomUUID() }
    if (!input) return
    pending.current = input; setBusy(true); setError(''); setNotice('')
    try { const result = await apiRequest('consultations/commands', input); if (result.id !== id) throw new Error('Não foi possível confirmar esta operação.'); pending.current = null; setUncertain(false); setNotice(result.message) }
    catch (failure) { setError(failure.message); if (failure.status && failure.status < 500) { pending.current = null; setUncertain(false); conversation.refresh() } else setUncertain(true) }
    finally { setBusy(false) }
  }
  const unread = shown?.items.filter(message => message.unread).map(message => message.id) || []
  return <section className={styles.conversation} aria-label="Conversa de acompanhamento" data-pending-command={busy || uncertain ? 'true' : undefined}>
    <h3>Conversa de acompanhamento</h3>
    {title && <p>{title}</p>}
    {error && <p role="alert" className="notice error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {uncertain && <button type="button" disabled={busy} onClick={() => decide(null, true)}>Verificar resultado</button>}
    <InformationCard cardId={'conversation:' + id} loading={conversation.loading} error={conversation.error} onRetry={conversation.refresh}>
      {value && <><p role="status">{value.blocked ? 'A conversa está encerrada para novas mensagens.' : 'Podes enviar uma mensagem sobre esta consulta.'}</p>
        <div className={styles.pages}>
          {shown?.hasOlder && <button type="button" className="text-button" onClick={() => setBefore(shown.items[0].sequence)}>Mensagens anteriores</button>}
          {before && <button type="button" className="text-button" onClick={() => setBefore(null)}>Ver mensagens recentes</button>}
        </div>
        {before && older.loading && <p role="status">A carregar mensagens anteriores…</p>}
        {before && older.error && <p role="alert" className="notice error">{older.error}<button type="button" onClick={older.refresh}>Tentar novamente</button></p>}
        <ol className={styles.messages}>{shown?.items.map(message => <li key={message.id} className={message.own ? styles.own : ''}>
          <p className={styles.author}>{message.author} · <time dateTime={message.createdAt}>{agendaDate(message.createdAt)}</time>{message.unread && <span> · Por ler</span>}</p>
          <p className={styles.text}>{message.text}</p>
        </li>)}</ol>
        {shown && !shown.items.length && <p>Ainda não existem mensagens.</p>}
        {unread.length > 0 && <button type="button" className="secondary" disabled={busy || uncertain} onClick={() => decide({ action: 'ReadMessages', messageIds: unread })}>Marcar estas mensagens como lidas</button>}
        {value.unread > unread.length && <p>Tens mensagens por ler noutras páginas da conversa.</p>}
        {manager && <button type="button" className="secondary" disabled={busy || uncertain} onClick={() => {
          if (window.confirm(value.blocked ? 'Reabrir esta conversa para novas mensagens?' : 'Encerrar esta conversa para novas mensagens? As mensagens anteriores mantêm-se.'))
            void decide({ action: value.blocked ? 'ReopenConversation' : 'BlockConversation', conversationVersion: value.conversationVersion })
        }}>{value.blocked ? 'Reabrir conversa' : 'Encerrar conversa'}</button>}
      </>}
    </InformationCard>
    {value && <MessageComposer id={id} title={title} value={value} disabled={busy || uncertain} onConfirmed={() => setBefore(null)} />}
  </section>
}

function MessageComposer({ id, title, value, disabled, onConfirmed }) {
  const [revision, setRevision] = useState(0)
  return <MessageForm key={revision} id={id} title={title} value={value} disabled={disabled} onConfirmed={() => { setRevision(n => n + 1); onConfirmed() }} />
}
function MessageForm({ id, title, value, disabled, onConfirmed }) {
  const draft = useClosureDraft({ id, serviceTitle: title, version: value.conversationVersion }, {
    scope: 'consultation-message:' + id, kind: 'ConsultationMessage', initialFields: { text: '', pending: null },
  })
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  async function send(retry = false) {
    if (busy || disabled || !navigator.onLine) { if (!navigator.onLine) setError('Sem ligação. A mensagem fica guardada neste aparelho.'); return }
    if (confirmed) {
      try { await draft.clear(); onConfirmed() } catch (failure) { setError(failure.message) }
      return
    }
    if (draft.fields.pending && !retry) return
    const command = retry ? draft.fields.pending : { action: 'SendMessage', id, conversationVersion: value.conversationVersion, messageText: draft.fields.text, operationId: crypto.randomUUID() }
    if (!command) return
    setBusy(true); setError('')
    try {
      draft.change('pending', command)
      await draft.flush()
    } catch (failure) { setError(failure.message); setBusy(false); return }
    try {
      const result = await apiRequest('consultations/commands', command)
      if (result.id !== command.operationId) throw new Error('Não foi possível confirmar o envio desta mensagem. O rascunho foi conservado.')
      setConfirmed(true)
      try { await draft.clear(); onConfirmed() }
      catch { setError('Mensagem enviada. Não foi possível remover a cópia temporária deste aparelho.') }
    } catch (failure) {
      setError(failure.message)
      if (failure.status && failure.status < 500) { draft.change('pending', null); await draft.flush().catch(() => {}); }
    } finally { setBusy(false) }
  }
  if (!draft.fields || !draft.available) return <p role="status">{draft.error || draft.status}</p>
  const pending = !!draft.fields.pending
  return <form data-protect-draft data-pending-command={busy || pending && !confirmed ? 'true' : undefined} onSubmit={event => { event.preventDefault(); void send() }}>
    <p role="status">{draft.status}</p>{(error || draft.error) && <p role="alert" className="notice error">{error || draft.error}</p>}
    {draft.conflict && !pending && <div className="notice"><p>O estado da conversa mudou. A tua mensagem foi conservada.</p><button type="button" className="secondary" onClick={draft.acceptCurrentVersion}>Revi o estado da conversa; manter a mensagem</button></div>}
    <label>Mensagem<textarea aria-label="Mensagem de acompanhamento" name="followupMessage" maxLength="8000" required value={draft.fields.text} disabled={disabled || busy || pending || confirmed} onChange={event => draft.change('text', event.target.value)} /></label>
    {confirmed ? <button type="button" disabled={busy} onClick={() => void send()}>Remover cópia temporária</button>
      : pending ? <button type="button" disabled={disabled || busy} onClick={() => void send(true)}>Verificar envio da mensagem</button>
        : <button disabled={disabled || busy || draft.conflict || value.blocked}>Enviar mensagem</button>}
  </form>
}
