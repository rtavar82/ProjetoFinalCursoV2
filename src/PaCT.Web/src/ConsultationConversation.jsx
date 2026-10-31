import { useCallback, useRef, useState } from 'react'
import { apiRequest, uploadConversationPhoto } from './identityApi'
import useLiveResource from './useLiveResource'
import useEditorState from './useEditorState'
import InformationCard from './InformationCard'
import ConsultationPhotoPreview from './ConsultationPhotoPreview'
import { agendaDate } from './agendaTime'
import styles from './ConsultationConversation.module.css'

function mergeMessages(...pages) {
  const messages = new Map()
  for (const message of pages.flat()) messages.set(message.id, { ...message, unread: messages.get(message.id)?.unread === false ? false : message.unread })
  return [...messages.values()].sort((a, b) => a.sequence - b.sequence)
}

export default function ConsultationConversation({ id, manager = false }) {
  const [before, setBefore] = useState(null)
  const [history, setHistory] = useState([])
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef(null)
  const read = useCallback(async signal => {
    const page = await apiRequest(`consultations/${id}/messages`, undefined, { signal })
    setHistory(previous => mergeMessages(previous, page.items)); return page
  }, [id])
  const readOlder = useCallback(async signal => {
    const page = await apiRequest(`consultations/${id}/messages?before=${before}`, undefined, { signal })
    setHistory(previous => mergeMessages(previous, page.items)); return page
  }, [id, before])
  const conversation = useLiveResource('consultationMessages', `messages:${id}:latest`, read)
  const older = useLiveResource('consultationMessages', `messages:${id}:${before}`, readOlder, !!before)
  const value = conversation.data
  const messages = mergeMessages(history, value?.items || [], older.data?.items || [])
  const gap = messages.findLast((message, index) => index > 0 && message.sequence > messages[index - 1].sequence + 1)
  const nextBefore = gap?.sequence || messages[0]?.sequence
  const hasOlder = nextBefore > 1 && (gap || value?.hasOlder)
  async function decide(command, retry = false) {
    if (busy) return
    if (pending.current && !retry) return
    const input = retry ? pending.current : { ...command, id, operationId: crypto.randomUUID() }
    if (!input) return
    pending.current = input; setBusy(true); setError(''); setNotice('')
    try {
      const result = await apiRequest('consultations/commands', input)
      if (result.id !== id) throw new Error('Não foi possível confirmar esta operação.')
      if (input.action === 'ReadMessages') setHistory(previous => previous.map(message => input.messageIds.includes(message.id) ? { ...message, unread: false } : message))
      pending.current = null; setUncertain(false); setNotice(result.message)
    }
    catch (failure) { setError(failure.message); if (failure.status && failure.status < 500) { pending.current = null; setUncertain(false); conversation.refresh() } else setUncertain(true) }
    finally { setBusy(false) }
  }
  const unread = messages.filter(message => message.unread).slice(0, 20).map(message => message.id)
  return <section className={styles.conversation} aria-label="Conversa de acompanhamento" data-pending-command={busy || uncertain ? 'true' : undefined}>
    <h3>Conversa de acompanhamento</h3>
    {error && <p role="alert" className="notice error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {uncertain && <button type="button" disabled={busy} onClick={() => decide(null, true)}>Verificar resultado</button>}
    {(!value || conversation.error || value.blocked || messages.length > 0) && <InformationCard cardId={'conversation:' + id} loading={conversation.loading} error={conversation.error} onRetry={conversation.refresh}>
      {value && <>{value.blocked && <p role="status">A conversa está encerrada para novas mensagens.</p>}
        <div className={styles.pages}>
          {hasOlder && <button type="button" className="text-button" disabled={older.loading} onClick={() => setBefore(nextBefore)}>Mensagens anteriores</button>}
        </div>
        {before && older.loading && <p role="status">A carregar mensagens anteriores…</p>}
        {before && older.error && <p role="alert" className="notice error">{older.error}<button type="button" onClick={older.refresh}>Tentar novamente</button></p>}
        <ol className={styles.messages}>{messages.map(message => <li key={message.id} className={message.own ? styles.own : ''}>
          {message.photoIds?.length > 0 && <div className={styles.images}>{message.photoIds.map((photoId, index) => <img key={photoId} loading="lazy" src={`/api/consultations/${id}/photos/${photoId}`} alt={`Imagem partilhada na conversa ${index + 1}`} />)}</div>}
          {message.text && <p className={styles.text}>{message.text}</p>}
          <small className={styles.author}>{message.author} · <time dateTime={message.createdAt}>{agendaDate(message.createdAt)}</time>{message.unread && <span> · Por ler</span>}</small>
        </li>)}</ol>
        {!manager && unread.length > 0 && <button type="button" className="secondary" disabled={busy || uncertain} onClick={() => decide({ action: 'ReadMessages', messageIds: unread })}>Marcar estas mensagens como lidas</button>}
        {value.unread > unread.length && <p>Existem mais mensagens por ler.</p>}
      </>}
    </InformationCard>}
    {value && <MessageComposer id={id} value={value} manager={manager} disabled={busy || uncertain} />}
    {manager && value && <button type="button" className={`secondary ${styles.close}`} disabled={busy || uncertain} onClick={() => {
      if (window.confirm(value.blocked ? 'Reabrir esta conversa para novas mensagens?' : 'Encerrar esta conversa para novas mensagens? As mensagens anteriores mantêm-se.'))
        void decide({ action: value.blocked ? 'ReopenConversation' : 'BlockConversation', conversationVersion: value.conversationVersion })
    }}>{value.blocked ? 'Reabrir conversa' : 'Encerrar conversa'}</button>}
  </section>
}

function MessageComposer({ id, value, manager, disabled }) {
  const [revision, setRevision] = useState(0)
  return <MessageForm key={revision} id={id} value={value} manager={manager} disabled={disabled} onConfirmed={() => setRevision(n => n + 1)} />
}
function MessageForm({ id, value, manager, disabled, onConfirmed }) {
  const editor = useEditorState({ text: '', photoIds: [], pending: null }, value.conversationVersion)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function send(retry = false) {
    if (busy || disabled) return
    if (editor.fields.pending && !retry) return
    setBusy(true); setError('')
    try {
      const current = await editor.ready()
      const command = retry ? current.fields.pending : { action: 'SendMessage', id, conversationVersion: value.conversationVersion, messageText: current.fields.text, photoIds: current.fields.photoIds, operationId: crypto.randomUUID() }
      if (!command) return
      if (!retry) {
        for (let i = 0; i < current.files.length; i++) await uploadConversationPhoto(id, command.photoIds[i], current.files[i], command.conversationVersion)
        editor.change('pending', command)
      }
      const result = await apiRequest('consultations/commands', command)
      if (result.id !== command.operationId) throw new Error('Não foi possível confirmar o envio desta mensagem. O texto foi mantido neste formulário.')
      onConfirmed()
    } catch (failure) {
      setError(failure.message)
      if (failure.status && failure.status < 500) editor.change('pending', null)
    } finally { setBusy(false) }
  }
  const pending = !!editor.fields.pending
  return <form data-protect-draft data-pending-command={busy || pending ? 'true' : undefined} onSubmit={event => { event.preventDefault(); void send() }}>
    {error && <p role="alert" className="notice error">{error}</p>}
    {editor.conflict && !pending && <div className="notice"><p>O estado da conversa mudou. O texto foi mantido.</p><button type="button" className="secondary" onClick={editor.acceptCurrentVersion}>Revi o estado da conversa; manter a mensagem</button></div>}
    <label>{manager ? 'Mensagem partilhada com o cliente' : 'Mensagem partilhada com a terapeuta'}<textarea name="followupMessage" maxLength="8000" required={editor.files.length === 0} value={editor.fields.text} disabled={disabled || busy || pending || value.blocked} onChange={event => editor.change('text', event.target.value)} /></label>
    {manager && !value.blocked && <label>Imagens para partilhar (opcional)<input type="file" accept="image/jpeg,image/png" multiple disabled={disabled || busy || pending || editor.conflict} onChange={async event => {
      const files = [...event.target.files]; event.target.value = ''
      try { await editor.addPhotos(files); setError('') } catch (failure) { setError(failure.message) }
    }} /></label>}
    {editor.files.map((file, index) => <div className={styles.photo} key={editor.fields.photoIds[index]}><p>{file.name}</p><ConsultationPhotoPreview file={file} /><button type="button" className="secondary" disabled={disabled || busy || pending || value.blocked} onClick={() => editor.removePhoto(index)}>Retirar imagem {index + 1}</button></div>)}
    {pending ? <button type="button" disabled={disabled || busy} onClick={() => void send(true)}>Verificar envio da mensagem</button>
        : <button disabled={disabled || busy || editor.conflict || value.blocked}>Enviar mensagem</button>}
  </form>
}
