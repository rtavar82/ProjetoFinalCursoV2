import eventStatusLabel from './eventStatusLabel'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import { announceOperation, dismissSuccess } from './actionNotices'
import useLiveResource from './useLiveResource'
import ClientCalendar from './ClientCalendar'
import ClientBookingDialog from './ClientBookingDialog'
import ClientEventDetail from './ClientEventDetail'
import ClientHistorySearch from './ClientHistorySearch'
import ClientPaymentPanel from './ClientPaymentPanel'
import ConsultationPaymentHistory from './ConsultationPaymentHistory'
import { ClosureAttachmentList } from './ClosureAttachments'
import ConsultationConversation from './ConsultationConversation'
import ConsultationDialog from './ConsultationDialog'
import ConsultationLocation from './ConsultationLocation'
import ConsultationValue from './ConsultationValue'
import ConsultationStatus from './ConsultationStatus'
import ConsultationConditionsForm from './ConsultationConditionsForm'
import GroupEventsPanel from './GroupEventsPanel'
import InformationCard from './InformationCard'
import Pagination from './Pagination'
import AppointmentCard from './AppointmentCard'
import AppointmentSummary from './AppointmentSummary'
import { agendaMoney } from './agendaTime'
import styles from './ClientAgenda.module.css'

const tabs = [['Payments', 'Pagamentos pendentes'], ['Upcoming', 'Próximas consultas'], ['Other', 'Consultas pendentes'], ['Cancelled', 'Canceladas'], ['Closed', 'Consultas fechadas']]
const explanations = {
  Payments: 'Consultas com pagamentos ou valores que aguardam validação, independentemente da data ou do estado da consulta.',
  Upcoming: 'Consultas confirmadas, com condições aceites, início futuro e sem pagamento pendente de validação.',
  Other: 'Pedidos por validar, marcações com condições por aceitar e consultas ainda por tratar.',
  Cancelled: 'Pedidos e marcações cancelados. Podes enviar para o histórico os que não têm pendências financeiras.',
  Closed: 'Consultas fechadas e pedidos expirados ou recusados, sem pendência financeira. Arquiva os registos depois de os veres.',
}

export default function ClientAgenda({ initialEntry, guard }) {
  const [view, setView] = useState(initialEntry?.events && !initialEntry?.participationId ? 'Calendar' : initialEntry?.id || initialEntry?.payments ? 'List' : 'Calendar')
  const [sectionChoice, setSectionChoice] = useState(() => ({ section: 'Payments', automatic: !initialEntry?.payments && !initialEntry?.id }))
  const section = sectionChoice.section
  const [page, setPage] = useState(1), [seen, setSeen] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [request, setRequest] = useState(null)
  const [detail, setDetail] = useState(null), [eventId, setEventId] = useState(initialEntry?.events && !initialEntry?.participationId ? initialEntry.id : null)
  const [followup, setFollowup] = useState(false)
  const [eventEntry, setEventEntry] = useState(initialEntry?.events && initialEntry?.participationId ? { id: initialEntry.participationId, sourceId: initialEntry.id } : null)
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false)
  const browseService = initialEntry?.serviceId || ''
  const [error, setError] = useState('')
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
      detailDirty.current = false; setDetail(value); setFollowup(!!initialEntry.followup)
      if (tabs.some(([section]) => section === value.section)) {
        setView('List'); setSectionChoice({ section: value.section, automatic: false }); setPage(1); setHistorySearch('')
        setSeen(value.section === 'Closed' && !!value.archivedAt && (value.archivedContentVersion ?? 1) === value.publicContentVersion)
      }
    } }).catch(failure => { if (current) setError(failure.message) })
    return () => { current = false }
  }, [initialEntry])
  useEffect(() => {
    if (!initialEntry?.events || !initialEntry.participationId) return
    const timer = window.setTimeout(() => { setEventEntry({ id: initialEntry.participationId, sourceId: initialEntry.id }); setView('List') }, 0)
    return () => window.clearTimeout(timer)
  }, [initialEntry])
  useEffect(() => {
    if (!initialEntry?.events || !initialEntry.id || initialEntry.participationId) return
    const timer = window.setTimeout(() => setEventId(initialEntry.id), 0)
    return () => window.clearTimeout(timer)
  }, [initialEntry?.events, initialEntry?.id, initialEntry?.participationId, initialEntry?.revision])
  async function send(command) {
    if (activeWrite.current) throw new Error('Aguarda a confirmação da operação.')
    const input = { ...command, operationId: command.operationId || crypto.randomUUID() }
    if (pending.current && JSON.stringify(pending.current) !== JSON.stringify(input)) throw new Error('Confirma primeiro o resultado da operação anterior.')
    dismissSuccess(); activeWrite.current = true; pending.current = input; setBusy(true); setError('')
    try {
      const result = await apiRequest('consultations/commands', input)
      if (!result.id || input.action === 'Request' && result.operationId !== input.operationId) throw new Error('Não foi possível confirmar o resultado. O pedido foi conservado.')
      pending.current = null; setUncertain(false); announceOperation(input, result, { client: true })
      return result
    } catch (failure) {
      setError(failure.message)
      if (failure.status && failure.status < 500) { pending.current = null; setUncertain(false) } else setUncertain(true)
      throw failure
    } finally { activeWrite.current = false; setBusy(false) }
  }
  async function act(action, extra = {}, retry = false) {
    try {
      const command = retry ? pending.current : { action: detail.kind === 'Guest' && action === 'Reject' ? 'RejectGuestRequest' : detail.kind === 'Guest' && action === 'Archive' ? 'ArchiveGuestRequest' : action, id: detail.id, version: detail.version, ...extra }
      if (!command) return
      const result = await send(command)
      if (command.action === 'DeclarePayment') { setDetail(null); list.refresh(); return result }
      if (detail) { try {
        const current = await apiRequest('consultations/' + detail.id)
        setDetail(current)
        if (['Accept', 'UseAuthorizedCredit'].includes(command.action) && tabs.some(([section]) => section === current.section)) {
          setSectionChoice({ section: current.section, automatic: false }); setView('List'); setPage(1)
        }
        return { ...result, resourceVersion: current.version }
      } catch { setError('A operação foi confirmada. Não foi possível atualizar os detalhes.'); latest.refresh() } }
      return result
    } catch (failure) { if (failure.status === 409) latest.refresh() }
  }
  async function open(id, showFollowup = false) { try { const value = await apiRequest('consultations/' + id); detailDirty.current = false; setDetail(value); setFollowup(showFollowup); setError('') } catch (failure) { setError(failure.message) } }
  function openEvent(id) { guard(() => setEventId(id)) }
  function startRequest(seed) { return guard(() => { setRequest({ id: crypto.randomUUID(), ...seed }); setError('') }) }
  const feedback = <>{error && <p role="alert" className="notice error">{error}</p>}{uncertain && !request && <button disabled={busy} onClick={() => void act(null, {}, true)}>Verificar resultado</button>}</>
  const result = list.data
  // Resolve the default once, from the actual Payments list. Explicit navigation
  // and later refreshes must never replace a section the client has chosen.
  if (sectionChoice.automatic && view === 'List' && result && !list.error) {
    setSectionChoice({ section: result.total === 0 ? 'Upcoming' : 'Payments', automatic: false })
  }
  function changeSection(value) { guard(() => { setSectionChoice({ section: value, automatic: false }); setPage(1); setSeen(false); setHistorySearch('') }) }
  return <section className={styles.page} data-pending-command={busy || uncertain ? 'true' : undefined} onChangeCapture={event => { if (event.target.closest('dialog form')) detailDirty.current = true }}>
    <p className={styles.eyebrow}>A tua agenda</p><h1>Um tempo para ti.</h1><p>Escolhe o dia. Encontra o teu horário.</p>
    {!detail && !request && !eventEntry && !eventId && feedback}
    <nav className={styles.primaryTabs} aria-label="Agenda"><button className={view === 'Calendar' ? styles.selected : 'secondary'} aria-pressed={view === 'Calendar'} onClick={() => guard(() => setView('Calendar'))}>Agendar</button><button className={view === 'List' ? styles.selected : 'secondary'} aria-pressed={view === 'List'} onClick={() => guard(() => setView('List'))}>As minhas marcações</button></nav>
    <div hidden={view !== 'Calendar'}><ClientCalendar shareRole="client" key={browseService} initialServiceId={browseService} enabled={view === 'Calendar'} onChoose={startRequest} onEvent={openEvent} /></div>
    {view === 'List' && <><nav className={styles.tabs} aria-label="Separadores de consultas">{tabs.map(([id, label]) => <button key={id} className={section === id ? styles.selected : 'secondary'} aria-pressed={section === id} onClick={() => changeSection(id)}>{label}</button>)}</nav>
      <p className={styles.muted}>{explanations[section]}</p>
      {section === 'Closed' && <nav className={styles.tabs} aria-label="Leitura das consultas"><button className={!seen ? '' : 'secondary'} onClick={() => guard(() => { setSeen(false); setPage(1) })}>Por ver{result && !search ? ` (${result.totalUnseen})` : ''}</button><button className={seen ? '' : 'secondary'} onClick={() => guard(() => { setSeen(true); setPage(1) })}>Histórico{result && !search ? ` (${result.totalSeen})` : ''}</button></nav>}
      {section === 'Closed' && seen && <ClientHistorySearch key={initialEntry?.revision || 'history'} services={result?.searchServices} onSearch={query => { setHistorySearch(query); setPage(1) }} />}
      {search && <p role="status" className={styles.muted}>Resultados em todos os teus registos.</p>}
      {result && <div className={styles.balances}><p>Saldo disponível na conta: <strong>{result.balance == null ? '—' : agendaMoney(result.balance)}</strong></p><p className={styles.debt}>Valor em dívida: <strong>{result.totalDebt == null ? '—' : agendaMoney(result.totalDebt)}</strong>{result.undefinedDebt ? ' · Acrescem valores por definir.' : ''}</p></div>}
      <InformationCard cardId="client-appointments" loading={list.loading} error={list.error} onRetry={list.refresh}>
        <div className={styles.list}>{result?.items.map(c => <AppointmentCard key={(c.kind || 'Consultation') + ':' + c.id} consultation={c}
          stateLabel={c.kind === 'Participation' ? eventStatusLabel(c, { participation: c }) : c.process.processLabel} typeLabel={c.activityKind === 'Retreat' ? 'Retiro' : c.activityKind === 'Group' ? 'Grupo' : 'Consulta individual'}
          actionLabel={c.section === 'Payments' ? 'Ver pagamento' : c.state === 'Performed' ? 'Ver consulta e acompanhamento' : 'Ver detalhes'}
          onOpen={() => c.kind === 'Participation' ? guard(() => setEventEntry(c)) : void open(c.id, c.state === 'Performed' && c.section === 'Closed')}
        >
          {c.section === 'Payments' && !/Aguarda confirmação de recebimento|Falta liquidar/.test(c.process.processLabel) && <p>{c.finalAmount == null && c.state === 'Performed' ? 'Valor por definir' : 'Pagamento pendente'}</p>}
          {c.kind === 'Participation' && c.amountDue > 0 && <p>Por pagar: {agendaMoney(c.amountDue)}</p>}
        </AppointmentCard>)}</div>
        {result?.total === 0 && <p className={styles.empty}>Não há marcações nesta lista.</p>}
        <Pagination total={result?.total} page={page} label="Páginas das marcações" onChange={next => guard(() => setPage(next))} />
      </InformationCard>
    </>}
    {eventId && <GroupEventsPanel manager={false} send={command => send(command).catch(() => null)} disabled={busy || uncertain} guard={guard} feedback={feedback} initialEntry={{ events: true, id: eventId }} onClose={() => setEventId(null)} />}
    {request && <ClientBookingDialog key={request.id} seed={request} send={send} disabled={busy} guard={guard} onClose={() => setRequest(null)} onConfirmed={() => { setRequest(null); setSectionChoice({ section: 'Other', automatic: false }); setPage(1); setView('List') }} />}
    {eventEntry && <ClientEventDetail entry={eventEntry} send={command => send(command).catch(() => null)} disabled={busy || uncertain} feedback={feedback} guard={guard} onClose={() => setEventEntry(null)} />}
    {detail && (followup && detail.state === 'Performed'
      ? <ClientFollowupDetail key={`${detail.id}:${initialEntry?.id === detail.id ? initialEntry.revision : ''}`} detail={detail} latest={latest} feedback={feedback} disabled={busy || uncertain} act={act} initialConversation={initialEntry?.id === detail.id && !!initialEntry.conversation} onClose={() => guard(() => setDetail(null))} onReview={() => guard(() => setDetail(latest.data))} onPayment={() => guard(() => setFollowup(false))} />
      : <ClientDetail detail={detail} latest={latest} feedback={feedback} disabled={busy || uncertain} act={act} onClose={() => guard(() => setDetail(null))} onReview={() => guard(() => setDetail(latest.data))} onFollowup={() => guard(() => setFollowup(true))} />)}
  </section>
}

function ClientDetail({ detail: c, latest, feedback, disabled, act, onClose, onReview, onFollowup }) {
  const changed = latest.data && (latest.data.version !== c.version || latest.data.state !== c.state)
  const paymentMode = c.paymentConditions?.mode || c.financialChoice || c.paymentMode
  const paymentFocus = c.section === 'Payments'
  return <ConsultationDialog title={c.serviceTitle} label="Detalhe da consulta" disabled={disabled} onClose={onClose}>
    <AppointmentSummary consultation={c} showTitle={false} stateLabel={<ConsultationStatus as="span" consultation={c} showAmount={!paymentFocus} />} typeLabel="Consulta individual" location={paymentFocus ? false : <ConsultationLocation {...c} />} />{feedback}
    {changed && <p className="notice" role="status">A consulta mudou. O preenchimento foi mantido.<button className="text-button" disabled={disabled} onClick={onReview}>Rever consulta</button></p>}
    {latest.error && <p role="alert" className="notice error">{latest.error}</p>}
    {paymentFocus ? <><ClientPaymentPanel consultation={c} disabled={disabled || changed} act={act} /><details className={styles.historySearch}><summary>Informação da consulta</summary><ConsultationLocation {...c} /><ConsultationValue consultation={c} /><p>Crédito disponível: {agendaMoney(c.balance)}</p></details></>
      : <><ConsultationValue consultation={c} />{c.paymentConditions?.label && !['Free', 'Gift', 'Contribution'].includes(paymentMode) && <p>{c.paymentConditions.label}</p>}<p>Crédito disponível: {agendaMoney(c.balance)}</p><ConsultationPaymentHistory entries={c.paymentHistory} /></>}
    {c.state === 'Confirmed' && c.creditProposals?.some(p => !p.decision) && <p>Proposta de utilização de crédito enviada à gestão.</p>}
    {c.state === 'NoShow' && <p>Não compareceste à consulta. Não tens nenhum valor a pagar por esta consulta.</p>}
    {!paymentFocus && c.actions?.includes('Accept') && <ConsultationConditionsForm key={`${c.id}:${c.version}:${c.termsVersion}`} consultation={c} disabled={disabled || changed} onAccept={values => act('Accept', values)} />}
    {c.actions?.includes('Reject') && <button className="secondary" disabled={disabled || changed} onClick={() => { if (window.confirm('Queres desistir deste pedido?')) void act('Reject') }}>Desistir do pedido</button>}
    {c.actions?.includes('Cancel') && <button className="secondary" disabled={disabled || changed} onClick={() => { if (window.confirm('Confirmas o cancelamento? Não há penalização financeira.')) void act('Cancel', { choice: 'Client' }) }}>Cancelar marcação</button>}
    {!paymentFocus && c.actions?.includes('DeclarePayment') && !c.expectationOpen && <button className="secondary" disabled={disabled || changed} onClick={() => void act('DeclarePayment')}>Comunicar pagamento à terapeuta</button>}
    {c.state === 'Performed' && <button className="secondary" disabled={disabled} onClick={onFollowup}>Ver consulta e acompanhamento com a terapeuta</button>}
    {c.state !== 'Performed' && (c.canArchive || c.actions?.includes('Archive')) && <button disabled={disabled || changed} onClick={() => void act('Archive', { publicContentVersion: c.publicContentVersion })}>Arquivar registo</button>}
  </ConsultationDialog>
}

function ClientFollowupDetail({ detail: c, latest, feedback, disabled, act, initialConversation, onClose, onReview, onPayment }) {
  const [conversation, setConversation] = useState(initialConversation)
  const presented = useRef(new Set())
  const rememberPresented = useCallback(items => { for (const message of items) if (!message.own) presented.current.add(message.id) }, [])
  const changed = latest.data && (latest.data.version !== c.version || latest.data.publicContentVersion !== c.publicContentVersion)
  const unread = !c.archivedAt || (c.archivedContentVersion ?? 1) !== c.publicContentVersion
  return <ConsultationDialog title={c.serviceTitle} label="Consulta e acompanhamento" disabled={disabled} onClose={onClose}>
    <AppointmentSummary consultation={{ ...c, startsAt: c.actualStartsAt || c.startsAt, endsAt: c.actualEndsAt || c.endsAt }} showTitle={false} stateLabel={<ConsultationStatus as="span" consultation={c} />} typeLabel="Consulta individual" location={<ConsultationLocation {...c} />} />{feedback}
    {latest.error && <p role="alert" className="notice error">{latest.error}</p>}
    {changed && <p role="status" className="notice">A informação da consulta mudou.<button type="button" className="text-button" disabled={disabled} onClick={onReview}>Rever informação atualizada</button></p>}
    <ConsultationValue consultation={c} />
    <ConsultationPaymentHistory entries={c.paymentHistory} />
    {c.section === 'Payments' && <button type="button" className="secondary" disabled={disabled} onClick={onPayment}>Ver pagamento</button>}
    <div className={styles.sharedImages}>{(c.photoIds || []).map((id, index) => <img key={id} loading="lazy" src={`/api/consultations/${c.id}/photos/${id}`} alt={`Fotografia partilhada ${index + 1}`} />)}</div>
    <ClosureAttachmentList consultationId={c.id} scope="shared" items={c.sharedClosureMedia} />
    <div className={styles.sharedNote}>{c.sharedNote || (c.sharedClosureMedia?.length ? null : 'Sem notas partilhadas.')}</div>
    {!conversation && <a href={'#acompanhamento-' + c.id} aria-disabled={disabled} onClick={event => { event.preventDefault(); if (!disabled) setConversation(true) }}>Abrir conversas de acompanhamento</a>}
    {conversation && <ConsultationConversation id={c.id} onMessagesPresented={rememberPresented} />}
    {(unread || c.unreadMessages > 0) && c.section === 'Closed' && <button disabled={disabled || changed} onClick={() => void act('Archive', { publicContentVersion: c.publicContentVersion, messageIds: [...presented.current] })}>Vi as informações do acompanhamento - quero arquivar</button>}
  </ConsultationDialog>
}
