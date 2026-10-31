import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import ClientCalendar from './ClientCalendar'
import ClientBookingDialog from './ClientBookingDialog'
import ClientEventDetail from './ClientEventDetail'
import ClientHistorySearch from './ClientHistorySearch'
import CreditSettlementForm from './CreditSettlementForm'
import ConsultationConversation from './ConsultationConversation'
import ConsultationDialog from './ConsultationDialog'
import ConsultationConditionsForm from './ConsultationConditionsForm'
import GroupEventsPanel from './GroupEventsPanel'
import InformationCard from './InformationCard'
import { agendaDate, agendaMoney, agendaClock } from './agendaTime'
import styles from './ClientAgenda.module.css'

const tabs = [['Payments', 'Pagamentos pendentes'], ['Upcoming', 'Próximas consultas'], ['Other', 'Consultas pendentes e canceladas'], ['Closed', 'Consultas fechadas']]
const explanations = {
  Payments: 'Consultas com pagamentos ou valores que aguardam validação, independentemente da data ou do estado da consulta.',
  Upcoming: 'Consultas confirmadas, com condições aceites, início futuro e sem pagamento pendente de validação.',
  Other: 'Consultas por confirmar, com condições por aceitar, por tratar ou canceladas, sem pagamento pendente de validação.',
  Closed: 'Consultas fechadas sem pendência financeira e pedidos ou marcações terminados que enviaste para o histórico.',
}
const pendingRequestNotice = 'Pedido enviado. Aguarda a confirmação da terapeuta.'

export default function ClientAgenda({ initialEntry, guard }) {
  const [view, setView] = useState(initialEntry?.events ? 'Events' : initialEntry?.id || initialEntry?.payments || initialEntry?.closed ? 'List' : 'Calendar')
  const [sectionChoice, setSectionChoice] = useState(() => ({ section: initialEntry?.closed ? 'Closed' : 'Payments', automatic: !initialEntry?.payments && !initialEntry?.closed }))
  const section = sectionChoice.section
  const [page, setPage] = useState(1), [seen, setSeen] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [request, setRequest] = useState(null)
  const [detail, setDetail] = useState(null), [eventId, setEventId] = useState(initialEntry?.events ? initialEntry.id : null)
  const [followup, setFollowup] = useState(false)
  const [eventEntry, setEventEntry] = useState(null)
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false)
  const browseService = initialEntry?.serviceId || ''
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  const pending = useRef(null), activeWrite = useRef(false)
  const detailDirty = useRef(false)
  const search = section === 'Closed' && seen ? historySearch : ''
  const read = useCallback(signal => apiRequest(`consultations?section=${section}&page=${page}${search ? '&' + search : section === 'Closed' ? '&seen=' + seen : ''}`, undefined, { signal }), [section, page, seen, search])
  const list = useLiveResource('consultations', `client-agenda:${section}:${page}:${seen}:${search}`, read, view === 'List')
  const detailId = detail?.id
  const readDetail = useCallback(signal => apiRequest('consultations/' + detailId, undefined, { signal }), [detailId])
  const latest = useLiveResource('consultations', 'detail:' + detailId, readDetail, !!detailId)
  useEffect(() => {
    if (!latest.data || busy || uncertain) return
    const update = window.setTimeout(() => { if (!detailDirty.current) setDetail(latest.data) }, 0)
    return () => window.clearTimeout(update)
  }, [latest.data, busy, uncertain])
  useEffect(() => {
    if (!initialEntry?.id || initialEntry.events) return
    let current = true
    apiRequest('consultations/' + initialEntry.id).then(value => { if (current) {
      setDetail(value); setFollowup(!!initialEntry.followup)
      if (tabs.some(([section]) => section === value.section)) { setView('List'); setSectionChoice({ section: value.section, automatic: false }); setPage(1) }
      if (initialEntry.closed) { setView('List'); setSectionChoice({ section: 'Closed', automatic: false }); setPage(1); setSeen(false) }
    } }).catch(failure => { if (current) setError(failure.message) })
    return () => { current = false }
  }, [initialEntry])
  async function send(command) {
    if (activeWrite.current) throw new Error('Aguarda a confirmação da operação.')
    const input = { ...command, operationId: command.operationId || crypto.randomUUID() }
    if (pending.current && JSON.stringify(pending.current) !== JSON.stringify(input)) throw new Error('Confirma primeiro o resultado da operação anterior.')
    activeWrite.current = true; pending.current = input; setBusy(true); setError(''); setMessage('')
    try {
      const result = await apiRequest('consultations/commands', input)
      if (!result.id || input.action === 'Request' && result.operationId !== input.operationId) throw new Error('Não foi possível confirmar o resultado. O pedido foi conservado.')
      pending.current = null; setUncertain(false); setMessage(result.message)
      return result
    } catch (failure) {
      setError(failure.message)
      if (failure.status && failure.status < 500) { pending.current = null; setUncertain(false) } else setUncertain(true)
      throw failure
    } finally { activeWrite.current = false; setBusy(false) }
  }
  async function act(action, extra = {}, retry = false) {
    try {
      const command = retry ? pending.current : { action: detail.kind === 'Guest' && action === 'Reject' ? 'RejectGuestRequest' : action, id: detail.id, version: detail.version, ...extra }
      if (!command) return
      const result = await send(command)
      if (detail) { try {
        const current = await apiRequest('consultations/' + detail.id)
        setDetail(current)
        if (command.action === 'Accept' && tabs.some(([section]) => section === current.section)) {
          setSectionChoice({ section: current.section, automatic: false }); setView('List'); setPage(1)
        }
      } catch { setError('A operação foi confirmada. Não foi possível atualizar os detalhes.'); latest.refresh() } }
      return result
    } catch (failure) { if (failure.status === 409) latest.refresh() }
  }
  async function open(id, showFollowup = false) { try { const value = await apiRequest('consultations/' + id); detailDirty.current = false; setDetail(value); setFollowup(showFollowup); setError('') } catch (failure) { setError(failure.message) } }
  async function archiveCard(item) {
    try { await send({ action: item.kind === 'Participation' ? 'ArchiveParticipation' : item.kind === 'Guest' ? 'ArchiveGuestRequest' : 'Archive', id: item.id, version: item.version, publicContentVersion: item.publicContentVersion }); setPage(1); list.refresh() }
    catch (failure) { if (failure.status === 409) list.refresh() }
  }
  function openEvent(id) { guard(() => { setEventId(id); setView('Events') }) }
  function startRequest(seed) { return guard(() => { setRequest({ id: crypto.randomUUID(), ...seed }); setError('') }) }
  const feedback = <>{error && <p role="alert" className="notice error">{error}</p>}{message && message !== pendingRequestNotice && <p role="status" className="notice success">{message}</p>}{uncertain && !request && <button disabled={busy} onClick={() => void act(null, {}, true)}>Verificar resultado</button>}</>
  const result = list.data
  // Resolve the default once, from the actual Payments list. Explicit navigation
  // and later refreshes must never replace a section the client has chosen.
  if (sectionChoice.automatic && view === 'List' && result && !list.error) {
    setSectionChoice({ section: result.total === 0 ? 'Upcoming' : 'Payments', automatic: false })
  }
  function changeSection(value) { guard(() => { setSectionChoice({ section: value, automatic: false }); setPage(1); setSeen(false); setHistorySearch('') }) }
  return <section className={styles.page} data-pending-command={busy || uncertain ? 'true' : undefined} onChangeCapture={event => { if (event.target.closest('dialog form')) detailDirty.current = true }}>
    <p className={styles.eyebrow}>A tua agenda</p><h1>Um tempo para ti.</h1><p>Escolhe o dia. Encontra o teu horário.</p>
    {!detail && !request && !eventEntry && view !== 'Events' && feedback}
    <nav className={styles.primaryTabs} aria-label="Agenda"><button className={view === 'Calendar' ? styles.selected : 'secondary'} aria-pressed={view === 'Calendar'} onClick={() => guard(() => setView('Calendar'))}>Agendar</button><button className={view === 'List' ? styles.selected : 'secondary'} aria-pressed={view === 'List'} onClick={() => guard(() => setView('List'))}>As minhas marcações</button></nav>
    <div hidden={view !== 'Calendar'}><ClientCalendar key={browseService} initialServiceId={browseService} enabled={view === 'Calendar'} onChoose={startRequest} onEvent={openEvent} /></div>
    {view === 'List' && <><nav className={styles.tabs} aria-label="Separadores de consultas">{tabs.map(([id, label]) => <button key={id} className={section === id ? styles.selected : 'secondary'} aria-pressed={section === id} onClick={() => changeSection(id)}>{label}</button>)}</nav>
      <p className={styles.muted}>{explanations[section]}</p>
      {section === 'Closed' && <nav className={styles.tabs} aria-label="Leitura das consultas"><button className={!seen ? '' : 'secondary'} onClick={() => guard(() => { setSeen(false); setPage(1) })}>Por ver{result && !search ? ` (${result.totalUnseen})` : ''}</button><button className={seen ? '' : 'secondary'} onClick={() => guard(() => { setSeen(true); setPage(1) })}>Histórico{result && !search ? ` (${result.totalSeen})` : ''}</button></nav>}
      {section === 'Closed' && seen && <ClientHistorySearch services={result?.searchServices} onSearch={query => { setHistorySearch(query); setPage(1) }} />}
      {search && <p role="status" className={styles.muted}>Resultados em todos os teus registos.</p>}
      {result && <div className={styles.balances}><p>Saldo disponível na conta: <strong>{result.balance == null ? '—' : agendaMoney(result.balance)}</strong></p><p className={styles.debt}>Valor em dívida: <strong>{result.totalDebt == null ? '—' : agendaMoney(result.totalDebt)}</strong>{result.undefinedDebt ? ' · Acrescem valores por definir.' : ''}</p></div>}
      <InformationCard cardId="client-appointments" loading={list.loading} error={list.error} onRetry={list.refresh}>
        <div className={styles.list}>{result?.items.map(c => <article className={styles.appointment} key={(c.kind || 'Consultation') + ':' + c.id}>{c.state === 'Requested' ? <p className="notice success">{c.process.processLabel}</p> : <span className={styles.badge}>{c.process.processLabel}</span>}<h2>{c.serviceTitle}</h2><p className={styles.muted}>{c.activityKind === 'Retreat' ? 'Retiro' : c.activityKind === 'Group' ? 'Grupo' : 'Consulta individual'}</p>{c.conditionsPending ? <p>Condições por aceitar</p> : c.section === 'Payments' && <p>{c.finalAmount == null && c.state === 'Performed' ? 'Valor por definir' : 'Pagamento pendente'}</p>}<p>{agendaDate(c.startsAt)} — {agendaClock(c.endsAt)}</p><p>{c.modality === 'Remote' ? 'Consulta remota' : c.publicLocation}</p>{c.kind === 'Participation' && c.amountDue > 0 && <p>Por pagar: {agendaMoney(c.amountDue)}</p>}<div className={styles.appointmentActions}><button type="button" className="secondary" onClick={() => c.kind === 'Participation' ? guard(() => setEventEntry(c)) : void open(c.id, c.state === 'Performed' && c.section === 'Closed')}>{c.section === 'Payments' ? 'Ver pagamento' : c.state === 'Performed' ? 'Ver consulta e acompanhamento' : 'Ver detalhes'}</button>{c.section === 'Other' && (c.canArchive || c.actions?.includes('Archive')) && <button type="button" className="secondary" disabled={busy || uncertain} onClick={() => void archiveCard(c)}>Enviar para o histórico</button>}</div></article>)}</div>
        {result?.total === 0 && <p className={styles.empty}>Não há marcações nesta lista.</p>}
        {result && result.total > 8 && <nav className="pager" aria-label="Páginas das marcações"><button disabled={page === 1} onClick={() => guard(() => setPage(n => n - 1))}>Anterior</button><span>Página {page}</span><button disabled={page * 8 >= result.total} onClick={() => guard(() => setPage(n => n + 1))}>Seguinte</button></nav>}
      </InformationCard>
    </>}
    {view === 'Events' && <GroupEventsPanel manager={false} send={command => send(command).catch(() => null)} disabled={busy || uncertain} guard={guard} feedback={feedback} initialEntry={eventId ? { events: true, id: eventId } : null} />}
    {request && <ClientBookingDialog key={request.id} seed={request} send={send} disabled={busy} guard={guard} onClose={() => setRequest(null)} onConfirmed={() => { setRequest(null); setSectionChoice({ section: 'Other', automatic: false }); setPage(1); setView('List') }} />}
    {eventEntry && <ClientEventDetail entry={eventEntry} send={command => send(command).catch(() => null)} disabled={busy || uncertain} feedback={feedback} guard={guard} onClose={() => setEventEntry(null)} />}
    {detail && (followup && detail.state === 'Performed'
      ? <ClientFollowupDetail key={`${detail.id}:${initialEntry?.id === detail.id ? initialEntry.revision : ''}`} detail={detail} latest={latest} feedback={feedback} disabled={busy || uncertain} act={act} initialConversation={initialEntry?.id === detail.id && !!initialEntry.conversation} onClose={() => guard(() => setDetail(null))} onReview={() => guard(() => setDetail(latest.data))} />
      : <ClientDetail detail={detail} latest={latest} feedback={feedback} disabled={busy || uncertain} act={act} onClose={() => guard(() => setDetail(null))} onReview={() => guard(() => setDetail(latest.data))} onFollowup={() => guard(() => setFollowup(true))} />)}
  </section>
}

function ClientDetail({ detail: c, latest, feedback, disabled, act, onClose, onReview, onFollowup }) {
  const changed = latest.data && (latest.data.version !== c.version || latest.data.state !== c.state)
  const paymentMode = c.paymentConditions?.mode || c.financialChoice || c.paymentMode
  return <ConsultationDialog compact label="Detalhe da consulta" disabled={disabled} onClose={onClose}><h2>{c.serviceTitle}</h2>{feedback}<p className="notice success">{c.process.processLabel}</p><p>{agendaDate(c.startsAt)} — {agendaClock(c.endsAt)}</p><p>{c.modality === 'Remote' ? 'Consulta remota' : c.publicLocation}</p>
    {changed && <p className="notice" role="status">A consulta mudou. O preenchimento foi mantido.<button className="text-button" disabled={disabled} onClick={onReview}>Rever consulta</button></p>}
    {latest.error && <p role="alert" className="notice error">{latest.error}</p>}
    <p>{c.state === 'Performed' ? c.finalAmount == null ? 'Valor final por definir' : `Valor final: ${agendaMoney(c.finalAmount)}` : ['Free', 'Gift'].includes(paymentMode) ? 'Sem pagamento.' : paymentMode === 'Contribution' ? 'Contribuição livre, paga depois da consulta.' : `Valor previsto: ${agendaMoney(c.referencePrice)}`}</p>
    {c.paymentConditions?.label && !['Free', 'Gift', 'Contribution'].includes(paymentMode) && <p>{c.paymentConditions.label}</p>}<p>Crédito disponível: {agendaMoney(c.balance)}</p>
    {c.instructions && <p className={styles.savedText}>{c.instructions}</p>}
    {c.state === 'Confirmed' && c.creditProposals?.some(p => !p.decision) && <p>Proposta de utilização de crédito enviada à gestão.</p>}
    {c.state === 'NoShow' && <p>Não compareceste à consulta. Não tens nenhum valor a pagar por esta consulta.</p>}
    {c.collectionClosed && <p className="notice">Para regularizar esta consulta, contacta diretamente a terapeuta.</p>}
    {c.actions?.includes('Accept') && <ConsultationConditionsForm key={`${c.id}:${c.version}:${c.termsVersion}`} consultation={c} disabled={disabled || changed} onAccept={values => act('Accept', values)} />}
    {c.actions?.includes('Reject') && <button className="secondary" disabled={disabled || changed} onClick={() => { if (window.confirm('Queres desistir deste pedido?')) void act('Reject') }}>Desistir do pedido</button>}
    {c.actions?.includes('Cancel') && <button className="secondary" disabled={disabled || changed} onClick={() => { if (window.confirm('Confirmas o cancelamento? Não há penalização financeira.')) void act('Cancel', { choice: 'Client' }) }}>Cancelar marcação</button>}
    {c.actions?.includes('DeclarePayment') && !c.expectationOpen && <button className="secondary" disabled={disabled || changed} onClick={() => void act('DeclarePayment')}>Comunicar pagamento à terapeuta</button>}
    {c.actions?.includes('ProposeCredit') && <CreditSettlementForm key={c.id} record={c} disabled={disabled || changed} act={act} />}
    {c.state === 'Performed' && <button className="secondary" disabled={disabled} onClick={onFollowup}>Ver consulta e acompanhamento com a terapeuta</button>}
    {c.state === 'NoShow' && c.section === 'Closed' && !c.archivedAt && <button disabled={disabled || changed} onClick={() => void act('Archive', { publicContentVersion: c.publicContentVersion })}>Já vi a informação sobre a consulta, posso arquivar.</button>}
  </ConsultationDialog>
}

function ClientFollowupDetail({ detail: c, latest, feedback, disabled, act, initialConversation, onClose, onReview }) {
  const [conversation, setConversation] = useState(initialConversation)
  const changed = latest.data && (latest.data.version !== c.version || latest.data.publicContentVersion !== c.publicContentVersion)
  const unread = !c.archivedAt || (c.archivedContentVersion ?? 1) !== c.publicContentVersion
  return <ConsultationDialog compact label="Consulta e acompanhamento" disabled={disabled} onClose={onClose}>
    <h2>{c.serviceTitle}</h2><p>{agendaDate(c.actualStartsAt || c.startsAt)}</p>{feedback}
    {latest.error && <p role="alert" className="notice error">{latest.error}</p>}
    {changed && <p role="status" className="notice">A informação da consulta mudou.<button type="button" className="text-button" disabled={disabled} onClick={onReview}>Rever informação atualizada</button></p>}
    <div className={styles.sharedImages}>{(c.photoIds || []).map((id, index) => <img key={id} loading="lazy" src={`/api/consultations/${c.id}/photos/${id}`} alt={`Fotografia partilhada ${index + 1}`} />)}</div>
    <div className={styles.sharedNote}>{c.sharedNote || 'Sem notas partilhadas.'}</div>
    {!conversation && <button type="button" className="secondary" disabled={disabled} onClick={() => setConversation(true)}>Ver conversa de acompanhamento{c.unreadMessages ? ` (${c.unreadMessages} por ler)` : ''}</button>}
    {conversation && <ConsultationConversation id={c.id} />}
    {unread && c.section === 'Closed' && <button disabled={disabled || changed} onClick={() => void act('Archive', { publicContentVersion: c.publicContentVersion })}>Já vi a informação sobre a consulta, posso arquivar.</button>}
  </ConsultationDialog>
}
