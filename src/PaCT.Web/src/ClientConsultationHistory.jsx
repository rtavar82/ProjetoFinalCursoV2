import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import InformationCard from './InformationCard'
import ConsultationConversation from './ConsultationConversation'
import { agendaDate } from './agendaTime'
import styles from './ClientConsultationHistory.module.css'

export default function ClientConsultationHistory({ initialEntry, guard }) {
  const [seen, setSeen] = useState(false)
  const [page, setPage] = useState(1)
  const [opened, setOpened] = useState(null)
  const [conversation, setConversation] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const pending = useRef(null)
  const read = useCallback(signal => apiRequest(`consultations?section=Closed&seen=${seen}&page=${page}`, undefined, { signal }), [seen, page])
  const history = useLiveResource('consultations', `followup:${seen}:${page}`, read)
  const entryId = initialEntry?.id, entryRevision = initialEntry?.revision
  useEffect(() => {
    if (!entryId) return
    let active = true
    apiRequest('consultations/' + entryId).then(value => { if (active) { setOpened(value); setConversation(value.state === 'Performed' ? { id: value.id, title: value.serviceTitle } : null) } }).catch(failure => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [entryId, entryRevision])
  async function archive(consultation, retry = false) {
    if (busy || !navigator.onLine) { if (!navigator.onLine) setError('Sem ligação. Volta a tentar quando tiveres rede.'); return }
    if (pending.current && !retry) return
    const command = retry ? pending.current : { action: 'Archive', id: consultation.id, version: consultation.version, publicContentVersion: consultation.publicContentVersion, operationId: crypto.randomUUID() }
    if (!command) return
    pending.current = command; setBusy(true); setError('')
    try { await apiRequest('consultations/commands', command); pending.current = null; setUncertain(false); if (opened?.id === command.id) setOpened(null) }
    catch (failure) { setError(failure.message); if (failure.status && failure.status < 500) { pending.current = null; setUncertain(false) } else setUncertain(true) }
    finally { setBusy(false) }
  }
  const result = history.data
  function openConversation(c) { guard(() => setConversation({ id: c.id, title: c.serviceTitle })) }
  return <section className={styles.page} data-pending-command={busy || uncertain ? 'true' : undefined}><h1>Consultas fechadas</h1>
    {error && <p role="alert" className="notice error">{error}</p>}{uncertain && <button disabled={busy} onClick={() => archive(null, true)}>Verificar resultado</button>}
    <nav className="section-tabs" aria-label="Leitura das consultas"><button className={!seen ? '' : 'secondary'} disabled={busy || uncertain} onClick={() => guard(() => { setSeen(false); setPage(1); setOpened(null) })}>Por ver{result ? ` (${result.totalUnseen ?? 0})` : ''}</button><button className={seen ? '' : 'secondary'} disabled={busy || uncertain} onClick={() => guard(() => { setSeen(true); setPage(1); setOpened(null) })}>Histórico{result ? ` (${result.totalSeen ?? 0})` : ''}</button></nav>
    {conversation && <ConsultationConversation key={conversation.id} id={conversation.id} title={conversation.title} />}
    {opened && ['Performed', 'NoShow'].includes(opened.state) && <SharedConsultation consultation={opened} disabled={busy || uncertain} archive={archive} openConversation={openConversation} />}
    <InformationCard cardId="client-followup-list" loading={history.loading} error={history.error} onRetry={history.refresh}>
      {result?.items.filter(c => c.id !== opened?.id).map(c => <SharedConsultation key={c.id} consultation={c} disabled={busy || uncertain} archive={archive} openConversation={openConversation} />)}
      {result?.total === 0 && !opened && <p>{seen ? 'Ainda não existem consultas no histórico.' : 'Não tens consultas por ver.'}</p>}
      {result && result.total > 8 && <nav className="pager" aria-label="Páginas das consultas fechadas"><button disabled={busy || uncertain || page === 1} onClick={() => guard(() => setPage(p => p - 1))}>Anterior</button><span>Página {page}</span><button disabled={busy || uncertain || page * 8 >= result.total} onClick={() => guard(() => setPage(p => p + 1))}>Seguinte</button></nav>}
    </InformationCard>
  </section>
}
function SharedConsultation({ consultation: c, disabled, archive, openConversation }) {
  const unread = !c.archivedAt || (c.archivedContentVersion ?? 1) !== c.publicContentVersion
  return <article className={styles.consultation}><h2>{c.serviceTitle}</h2><p>{agendaDate(c.actualStartsAt || c.startsAt)}</p>{c.state === 'Performed' && <div className={styles.note}>{c.sharedNote || 'Sem notas partilhadas.'}</div>}
    {c.state === 'NoShow' && <p>Não compareceste à consulta. Não tens nenhum valor a pagar por esta consulta.</p>}
    <div className={styles.images}>{(c.photoIds || []).map((id, index) => <img key={id} loading="lazy" src={`/api/consultations/${c.id}/photos/${id}`} alt={`Fotografia partilhada ${index + 1}`} />)}</div>
    {unread && c.section === 'Closed' && <button disabled={disabled} onClick={() => archive(c)}>Já vi a informação sobre a consulta, posso arquivar.</button>}
    {c.state === 'Performed' && <button type="button" className="secondary" disabled={disabled} onClick={() => openConversation(c)}>Ver conversa{c.unreadMessages ? ` (${c.unreadMessages} por ler)` : ''}</button>}
  </article>
}
