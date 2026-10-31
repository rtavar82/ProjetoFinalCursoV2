import AdaptiveSelect from './AdaptiveSelect'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import styles from './Consultations.module.css'
import InformationCard from './InformationCard'
import CardGrid from './CardGrid'
import SummaryCard from './SummaryCard'
import AppointmentCard from './AppointmentCard'
import useLiveResource from './useLiveResource'
import BookingClientSearch from './BookingClientSearch'
import useConsultationNames from './useConsultationNames'
import Clients from './Clients'
import FinancePanel, { FinancialEntryForm } from './FinancePanel'
import CreditSettlementForm from './CreditSettlementForm'
import AgendaSetup from './AgendaSetup'
import AgendaCalendar from './AgendaCalendar'
import BookingForm from './BookingForm'
import ConsultationResolution from './ConsultationResolution'
import ConsultationDialog from './ConsultationDialog'
import ConsultationConditionsForm from './ConsultationConditionsForm'
import GuestRequests from './GuestRequests'
import SessionPacksPanel from './SessionPacksPanel'
import GroupEventsPanel from './GroupEventsPanel'
import ConsultationConversation from './ConsultationConversation'
import ManagerAgenda from './ManagerAgenda'
import ManagerVisitorAgenda from './ManagerVisitorAgenda'
import ManagerSchedulingDialog from './ManagerSchedulingDialog'
import ManualBookingForm from './ManualBookingForm'
import AvailabilityEditorForm from './AvailabilityEditorForm'
import { addDays, agendaMoney as money, agendaDate as date, localDate as lisbonParts, instant } from './agendaTime'

const labels = { Requested: 'A aguardar confirmação', Confirmed: 'Confirmada', AwaitingClosure: 'A aguardar fecho', Performed: 'Realizada', NoShow: 'Não compareceu', CancelledClient: 'Cancelada pelo cliente', CancelledManager: 'Cancelada pela terapeuta', Rejected: 'Recusada', Expired: 'Expirada', ConditionsPending: 'Por validar condições', AwaitingReceipt: 'Aguarda recebimento', ContributionUndefined: 'Por pagar — contribuição por definir', ContributionPending: 'Por pagar — contribuição pendente', Unpaid: 'Por pagar', Paid: 'Paga', NoDebt: 'Sem dívida', Prepayment: 'Pré-pagamento', Postpayment: 'Pagamento posterior', Contribution: 'Contribuição livre', Free: 'Gratuita', Gift: 'Oferta de pagamento', Credit: 'Usar crédito (sem desconto antecipado)', Receipt: 'Recebimento', Settlement: 'Liquidação', Reversal: 'Anulação integral' }
const activityStates = { Scheduled: 'Agendado', Waiting: 'Em espera', Cancelled: 'Cancelada' }

export default function Consultations({ manager, area, initialEntry, onCreateClient, perform, notify, profileBusy = false, guard = action => action() }) {
  const managementAgenda = manager && area === 'Agenda'
  const [section, setSection] = useState(area === 'Consultations' ? 'Closure' : manager ? 'Upcoming' : 'Payments')
  const [view, setView] = useState(initialEntry?.packs ? 'Packs' : initialEntry?.events ? 'Events' : initialEntry?.guests ? 'Guests' : area === 'Agenda' && !manager && !initialEntry?.payments ? 'Calendar' : 'List')
  const [booking, setBooking] = useState(null)
  const [managerDialog, setManagerDialog] = useState(null)
  const [visitorView, setVisitorView] = useState(false)
  const [dialogWorking, setDialogWorking] = useState(false)
  const [domainEntry, setDomainEntry] = useState(null)
  const [filterClient, setFilterClient] = useState(null)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState('')
  const [searching, setSearching] = useState(false)
  const [detail, setDetail] = useState(null)
  const [clientProfileId, setClientProfileId] = useState(null)
  const [approvalChoice, setApprovalChoice] = useState('')
  const [followup, setFollowup] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const pending = useRef(null)
  const pendingCleanup = useRef(null)
  const detailDirty = useRef(false)
  const readList = useCallback(signal => apiRequest(`consultations?section=${section}&page=${page}&search=${searching}${!manager && section === 'Closed' ? '&state=NoShow' : ''}${filters}`, undefined, { signal }), [section, page, searching, filters, manager])
  const list = useLiveResource('consultations', `${area}|${section}|${page}|${searching}|${filters}`, readList, area !== 'Finance' && !managementAgenda && view === 'List')
  const result = list.data
  useEffect(() => {
    if (!result || list.error || page <= Math.max(1, Math.ceil(result.total / 8))) return
    const correction = window.setTimeout(() => setPage(Math.max(1, Math.ceil(result.total / 8))), 0)
    return () => window.clearTimeout(correction)
  }, [result, list.error, page])
  const names = useConsultationNames(view === 'List' ? result?.items || [] : [], detail, manager)
  const readSetup = useCallback(signal => apiRequest(manager ? 'consultations/setup' : 'consultations/availability', undefined, { signal }), [manager])
  const agenda = useLiveResource('agenda', manager ? 'management' : 'availability', readSetup, area === 'Agenda' && (['Setup', 'Booking'].includes(view) || !!managerDialog))
  const setup = agenda.data
  const detailId = detail?.id
  const readDetail = useCallback(signal => apiRequest('consultations/' + detailId, undefined, { signal }), [detailId])
  const latestDetail = useLiveResource('consultations', 'detail:' + detailId, readDetail, !!detailId)
  useEffect(() => {
    if (!latestDetail.data || busy || uncertain) return
    const update = window.setTimeout(() => { if (!detailDirty.current) setDetail(latestDetail.data) }, 0)
    return () => window.clearTimeout(update)
  }, [latestDetail.data, busy, uncertain])
  useEffect(() => {
    if (!initialEntry?.id || initialEntry.payments || initialEntry.guests || initialEntry.events || initialEntry.packs) return
    let current = true
    apiRequest('consultations/' + initialEntry.id).then(value => { if (current) setDetail(value) }).catch(failure => { if (current) setError(failure.message) })
    return () => { current = false }
  }, [initialEntry])
  async function send(command, retry = false, onConfirmed = null, onRejected = null) {
    if (busy) return
    if (pending.current && !retry) { setError('Confirma primeiro o resultado da operação anterior, repetindo apenas essa mesma operação.'); return }
    const input = retry ? pending.current : { ...command, operationId: crypto.randomUUID() }
    if (!input) return
    if (!retry) pendingCleanup.current = onConfirmed
    pending.current = input; setBusy(true); setError(''); setMessage('')
    try {
      const response = await apiRequest('consultations/commands', input)
      pending.current = null; setUncertain(false); setMessage(response.message)
      const cleanup = pendingCleanup.current; pendingCleanup.current = null
      if (cleanup) { try { await cleanup() } catch (failure) { setError('A operação foi confirmada no servidor, mas não foi possível atualizar o formulário: ' + failure.message) } }
      if (manager && ['Approve', 'Close', 'Receipt'].includes(input.action)) {
        setDetail(null); setApprovalChoice('')
      } else if (detail) {
        try { setDetail(await apiRequest('consultations/' + detail.id)) }
        catch { setDetail(null); setError('A operação foi concluída, mas não foi possível atualizar os detalhes. Volta a abrir a consulta.') }
      }
      return response
    } catch (failure) {
      if (failure.status && failure.status < 500) { pending.current = null; pendingCleanup.current = null; setUncertain(false); onRejected?.(failure) } else setUncertain(true)
      setError(failure.message)
    } finally { setBusy(false) }
  }
  function submit(event, build) {
    event.preventDefault()
    const form = event.currentTarget
    const values = () => JSON.stringify([...new FormData(form)].map(([name, value]) => [name, typeof value === 'string' ? value : [value.name, value.size, value.lastModified]]))
    const submitted = values()
    try {
      return send(build(new FormData(form))).then(response => {
        if (!response) return null
        const editorUnchanged = values() === submitted
        if (editorUnchanged) form.reset()
        else setMessage(response.message + ' As alterações que fizeste durante o envio foram mantidas e ainda não foram guardadas.')
        return { ...response, editorUnchanged }
      })
    } catch (failure) { setError(failure.message); return Promise.resolve(null) }
  }
  async function open(id, notes = false) { try { const value = await apiRequest('consultations/' + id); detailDirty.current = false; setDetail(value); setApprovalChoice(''); setFollowup(notes); setError('') } catch (failure) { setError(failure.message) } }
  function openDomain(kind, id) { guard(() => { setDomainEntry({ kind, id }); setView(kind === 'Pack' ? 'Packs' : 'Events') }) }
  function openManagementRow(row) {
    if (!row.kind || row.kind === 'Consultation') return open(row.id)
    setDomainEntry({ kind: row.kind === 'Guest' ? 'Guest' : 'Event', id: row.sourceId, participationId: row.kind === 'Participation' ? row.id : null, revision: Date.now() })
    setView(row.kind === 'Guest' ? 'Guests' : 'Events')
  }
  async function closeDetail() {
    if (busy || uncertain) return
    if (document.querySelector('.consultation-dialog [data-pending-command="true"]')) { setError('Confirma o resultado da operação antes de fechar.'); return }
    await guard(() => setDetail(null))
  }
  const act = (action, values = {}) => send({ action, id: detail.id, version: detail.version, ...values })
  const tabs = area === 'Consultations' ? [['Closure', 'Por fechar'], ['Performed', 'Realizadas'], ['NoShow', 'Não compareceu'], ['Cancelled', 'Canceladas']]
    : manager ? [['Requests', 'Pedidos por validar'], ['AwaitingReceipt', 'A aguardar recebimento'], ['Upcoming', 'Próximas consultas'], ['Ended', 'Recusados e expirados']]
      : [['Payments', 'Pagamentos pendentes'], ['Upcoming', 'Próximas consultas'], ['Other', 'Consultas pendentes e canceladas'], ['Closed', 'Não compareceu']]
  const feedback = <>{error && <p role="alert" className="notice error">{error}</p>}{message && <p role="status" className="notice success">{message}</p>}
    {uncertain && <button disabled={busy} onClick={() => send(null, true)}>Verificar resultado</button>}</>
  return <section className={styles.page} data-pending-command={busy || uncertain ? 'true' : undefined} onChangeCapture={event => { if (event.target.closest('dialog form')) detailDirty.current = true }}>
    <div hidden={!!clientProfileId}>
    {(!managementAgenda || view !== 'List') && <><h1>{area === 'Finance' ? 'Financeiro' : area === 'Consultations' ? 'Consultas' : view === 'Setup' ? 'Construir e editar agenda' : view === 'Booking' ? 'Agendamento manual' : 'Agenda'}</h1><p>Datas e horas de Lisboa.</p></>}
    {managementAgenda && view !== 'List' && <button className="text-button" disabled={busy || uncertain} onClick={() => guard(() => setView('List'))}>← Voltar à agenda</button>}
    {!detail && !managerDialog && !['Guests', 'Packs', 'Events'].includes(view) && feedback}
    {names.error && <InformationCard error={names.error} onRetry={names.refresh} cardId="consultation-names-error" />}
    {area !== 'Finance' && agenda.error && <InformationCard error={agenda.error} onRetry={agenda.refresh} cardId="agenda-error" />}
    {manager && area !== 'Finance' && !managementAgenda && <details hidden={view !== 'List'} className={styles.filters}><summary>Pesquisar consultas</summary><form className={styles.filterFields} onSubmit={e => {
      e.preventDefault(); try {
        const f = new FormData(e.currentTarget); const q = new URLSearchParams()
        for (const name of ['personId', 'state', 'financial', 'sort', 'hasNotes']) if (f.get(name)) q.set(name, f.get(name))
        if (f.get('from')) q.set('from', instant(f.get('from')))
        if (f.get('to')) q.set('to', instant(f.get('to')))
        setFilters('&' + q.toString()); setSearching(f.has('global')); setPage(1); setView('List')
      } catch (failure) { setError(failure.message) }
    }}><label className={`checkbox ${styles.filterWide}`}><input name="global" type="checkbox" defaultChecked />Pesquisa global, independente dos separadores</label>
      <label>Estado<AdaptiveSelect name="state"><option value="">Todos</option>{['Requested', 'Confirmed', 'AwaitingClosure', 'Performed', 'NoShow', 'CancelledClient', 'CancelledManager', 'Rejected', 'Expired', 'Scheduled', 'Waiting', 'Cancelled'].map(v => <option key={v} value={v}>{labels[v] || activityStates[v]}</option>)}</AdaptiveSelect></label>
      <label>Situação financeira<AdaptiveSelect name="financial"><option value="">Todas</option>{['Unpaid', 'ContributionUndefined', 'ContributionPending', 'Paid', 'NoDebt', 'AwaitingReceipt'].map(v => <option key={v} value={v}>{labels[v]}</option>)}<option value="CollectionClosed">Cobrança encerrada sem pagamento</option></AdaptiveSelect></label>
      <label>Desde (Lisboa)<input name="from" type="datetime-local" /></label><label>Até, exclusivo (Lisboa)<input name="to" type="datetime-local" /></label>
      <label>Notas<AdaptiveSelect name="hasNotes"><option value="">Com ou sem notas</option><option value="true">Com notas</option><option value="false">Sem notas</option></AdaptiveSelect></label>
      <label>Ordenação<AdaptiveSelect name="sort"><option value="">Inicial do separador</option><option value="Oldest">Mais antigas primeiro</option><option value="Newest">Mais recentes primeiro</option></AdaptiveSelect></label>
      <div className={styles.filterWide}><BookingClientSearch purpose="filter" selected={filterClient} onSelect={setFilterClient} disabled={busy || uncertain} /></div>
      <button className={styles.filterWide} disabled={busy || uncertain}>Pesquisar</button>{searching && <p className={styles.filterWide}>Resultados de consultas individuais, pedidos, grupos, oficinas e retiros.</p>}
    </form></details>}
    {managementAgenda && visitorView && <ManagerVisitorAgenda onBack={() => { setVisitorView(false); window.scrollTo(0, 0) }} />}
    {managementAgenda && <div hidden={view !== 'List' || visitorView}><ManagerAgenda enabled={view === 'List' && !visitorView} disabled={busy || uncertain}
      onVisitorView={() => guard(() => { setError(''); setMessage(''); setVisitorView(true); window.scrollTo(0, 0) })}
      onSetup={() => guard(() => { setError(''); setMessage(''); setManagerDialog('Availability') })} onBooking={() => guard(() => { setError(''); setMessage(''); setBooking(null); setManagerDialog('Manual') })}
      onOpen={row => guard(() => openManagementRow(row))} /></div>}
    {area === 'Agenda' && !managementAgenda && <nav className="consultation-tabs" aria-label="Agenda">
      <button className={view === 'Calendar' ? '' : 'secondary'} aria-pressed={view === 'Calendar'} disabled={busy || uncertain} onClick={() => guard(() => setView('Calendar'))}>{manager ? 'Calendário' : 'Agendar'}</button>
      <button className={view === 'List' ? '' : 'secondary'} aria-pressed={view === 'List'} disabled={busy || uncertain} onClick={() => guard(() => setView('List'))}>{manager ? 'Marcações' : 'As minhas marcações'}</button>
      {manager && <><button className={view === 'Booking' ? '' : 'secondary'} aria-pressed={view === 'Booking'} disabled={busy || uncertain} onClick={() => guard(() => { setBooking(null); setView('Booking') })}>Agendamento manual</button><button className={view === 'Setup' ? '' : 'secondary'} aria-pressed={view === 'Setup'} disabled={busy || uncertain} onClick={() => guard(() => setView('Setup'))}>Construir e editar agenda</button></>}
    </nav>}
    {managementAgenda && view !== 'List' && view !== 'Booking' && <nav className="consultation-tabs" aria-label="Configuração da agenda">
      {[['Setup', 'Catálogo e horários'], ['Calendar', 'Calendário'], ['Packs', 'Packs'], ['Events', 'Grupos e retiros'], ['Guests', 'Pedidos sem conta']].map(([key, label]) => <button key={key} className={view === key ? '' : 'secondary'} aria-pressed={view === key} disabled={busy || uncertain} onClick={() => guard(() => { setDomainEntry(null); setView(key) })}>{label}</button>)}
    </nav>}
    {area === 'Agenda' && !managementAgenda && <nav className="consultation-tabs" aria-label="Outras áreas da agenda">
      {manager && <button className={view === 'Guests' ? '' : 'secondary'} disabled={busy || uncertain} onClick={() => guard(() => setView('Guests'))}>Pedidos sem conta</button>}
      <button className={view === 'Packs' ? '' : 'secondary'} disabled={busy || uncertain} onClick={() => guard(() => { setDomainEntry(null); setView('Packs') })}>Packs</button>
      <button className={view === 'Events' ? '' : 'secondary'} disabled={busy || uncertain} onClick={() => guard(() => { setDomainEntry(null); setView('Events') })}>Grupos e retiros</button>
    </nav>}
    {['Agenda', 'Finance'].includes(area) && view === 'Packs' && <SessionPacksPanel manager={manager} send={send} disabled={busy || uncertain} guard={guard} feedback={feedback} initialId={domainEntry?.kind === 'Pack' ? domainEntry.id : initialEntry?.packs ? initialEntry.id : null} />}
    {area === 'Consultations' && ['Guests', 'Events'].includes(view) && <button type="button" className="text-button" disabled={busy || uncertain} onClick={() => guard(() => { setDomainEntry(null); setView('List') })}>← Voltar às consultas</button>}
    {['Agenda', 'Finance', 'Consultations'].includes(area) && view === 'Events' && <GroupEventsPanel manager={manager} send={send} disabled={busy || uncertain} guard={guard} feedback={feedback} initialEntry={domainEntry?.kind === 'Event' ? { ...domainEntry, events: true } : initialEntry} />}
    {['Agenda', 'Consultations'].includes(area) && manager && view === 'Guests' && <GuestRequests send={send} disabled={busy || uncertain} guard={guard} onCreateClient={onCreateClient} feedback={feedback} initialId={domainEntry?.kind === 'Guest' ? domainEntry.id : null} />}
    {area === 'Agenda' && <div hidden={view !== 'Calendar'}><AgendaCalendar manager={manager} enabled={view === 'Calendar'} onChoose={value => guard(() => { setBooking(value); if (managementAgenda) setManagerDialog('Manual'); else setView('Booking') })} onDay={day => guard(() => { setFilters('&' + new URLSearchParams({ from: instant(day + 'T00:00'), to: instant(addDays(day, 1) + 'T00:00'), sort: 'Oldest' })); setSearching(true); setPage(1); setView('List') })} /></div>}
    {['Setup', 'Booking'].includes(view) && agenda.loading && <p role="status">A carregar os dados para agendar…</p>}
    {view === 'Setup' && setup && <AgendaSetup setup={setup} submit={submit} publish={(command, cleanup) => send(command, false, cleanup)} refresh={agenda.refresh} disabled={busy || uncertain} instant={instant} formatDate={date} localDate={lisbonParts} />}
    {view === 'Booking' && setup && <BookingForm setup={setup} seed={booking} feedback={feedback} disabled={busy || uncertain} onWorking={setDialogWorking} onReviewStart={() => { setError(''); setMessage('') }} publish={(command, cleanup, rejected) => send(command, false, cleanup, rejected)} onSaved={() => setView('List')} onBack={() => guard(() => setView(managementAgenda ? 'List' : 'Calendar'))} />}
    {managementAgenda && managerDialog && <ManagerSchedulingDialog title={managerDialog === 'Manual' ? 'Marcação manual' : 'Editar agenda'} disabled={busy || uncertain || dialogWorking} onClose={() => guard(() => setManagerDialog(null))}>
      {agenda.loading && <p role="status">A carregar os dados da agenda…</p>}
      {agenda.error && <div className="notice error" role="alert"><p>{agenda.error}</p><button className="secondary" onClick={agenda.refresh}>Voltar a tentar</button></div>}
      {setup && (managerDialog === 'Manual' ? <ManualBookingForm setup={setup} seed={booking} disabled={busy || uncertain} feedback={feedback} onWorking={setDialogWorking} onReviewStart={() => { setError(''); setMessage('') }}
        publish={(command, cleanup, rejected) => send(command, false, cleanup, rejected)} onBack={() => guard(() => setManagerDialog(null))} onSaved={() => setManagerDialog(null)} />
        : <AvailabilityEditorForm setup={setup} disabled={busy || uncertain} feedback={feedback} refresh={agenda.refresh} onWorking={setDialogWorking} onReviewStart={() => { setError(''); setMessage('') }}
          publish={(command, cleanup, rejected) => send(command, false, cleanup, rejected)} onBack={() => guard(() => setManagerDialog(null))} onSaved={() => setManagerDialog(null)} />)}
    </ManagerSchedulingDialog>}
    {area === 'Finance' && (['Packs', 'Events'].includes(view) ? <button className="secondary" disabled={busy || uncertain} onClick={() => guard(() => { setDomainEntry(null); setView('List') })}>Voltar ao financeiro</button> : <FinancePanel guard={guard} disabled={busy || uncertain} submit={submit} open={open} instant={instant} onOpenDomain={openDomain} />)}
    {view === 'List' && area !== 'Finance' && !managementAgenda && <>
      <nav className="consultation-tabs" aria-label="Separadores de consultas">{tabs.map(([key, text]) => <button key={key} className={section === key ? '' : 'secondary'} aria-pressed={section === key} onClick={() => guard(() => { setSection(key); setPage(1); setSearching(false) })}>{text}</button>)}</nav>
      <InformationCard className={styles.results} cardId="consultation-results" loading={list.loading} refreshing={list.refreshing} error={list.error} onRetry={list.refresh}>{result && <>
        <SummaryCard cardId="consultation-count" label={searching ? 'Resultados da pesquisa' : tabs.find(([key]) => key === section)?.[1]} value={result.total} unit="registos" icon="calendar" />
        <CardGrid>{result.items.map(c => <AppointmentCard key={(c.kind || 'Consultation') + ':' + c.id} consultation={c} clientName={manager && c.personId ? names.data?.[c.personId] || (names.loading ? 'A consultar o nome do cliente…' : 'Ficha de cliente') : null} stateLabel={c.process.processLabel} financialLabel={labels[c.financialState]} actionLabel={c.kind === 'Guest' ? 'Analisar pedido' : c.kind === 'Participation' ? 'Abrir participação' : c.kind === 'Event' ? 'Abrir atividade' : section === 'Payments' ? 'Abrir pagamento' : 'Abrir consulta'} onOpen={() => guard(() => openManagementRow(c))} />)}</CardGrid>
        {result.total === 0 && <p>Não há consultas neste separador.</p>}{result.total > 8 && <nav className="consultation-tabs" aria-label="Páginas das consultas"><button disabled={page === 1} onClick={() => setPage(x => x - 1)}>Anterior</button><span>Página {page}</span><button disabled={page * 8 >= result.total} onClick={() => setPage(x => x + 1)}>Seguinte</button></nav>}
      </>}</InformationCard>
    </>}
    {detail && !clientProfileId && <ConsultationDialog compact onClose={closeDetail} disabled={busy || uncertain}><h2>{detail.serviceTitle}</h2><p>{date(detail.startsAt)} — {date(detail.endsAt)}</p><p>{detail.process.processLabel} · {labels[detail.financialState]}</p><p>{detail.publicLocation} · {detail.modality === 'Remote' ? 'Remota' : 'Presencial'}</p>
      {manager && <p><button type="button" className={`text-button ${styles.clientLink}`} disabled={busy || uncertain || !detail.personId} onClick={() => guard(() => setClientProfileId(detail.personId))}>{names.data?.[detail.personId] || (names.loading ? 'A consultar o nome do cliente…' : 'Ficha de cliente')}</button></p>}
      {feedback}
      {latestDetail.error && <p className="notice error" role="status">Não foi possível atualizar esta consulta. Os campos em edição foram mantidos.</p>}
      {latestDetail.data && latestDetail.data.version !== detail.version && <p className="notice" role="status">Esta consulta foi alterada. Os teus campos não foram substituídos. Fecha e volta a abrir para rever a informação antes de guardar.</p>}
      {(!followup || manager) && <><p>Referência: {money(detail.referencePrice)} · Valor final: {money(detail.finalAmount)}</p><p>Crédito disponível: {money(detail.balance)}</p>{detail.instructions && <p>{detail.instructions}</p>}</>}
      {detail.advanceSatisfiedAt && <p>Condição de antecipação satisfeita.</p>}
      {detail.collectionClosed && <div className="notice"><p>Por pagar — Cobrança encerrada</p><p>Para regularizar esta consulta, contacta diretamente a terapeuta.</p></div>}
      {manager && detail.paymentAlert && <div className="notice"><p>Comunicação de pagamento do cliente</p><p>Confirma o dinheiro recebido ou marca a comunicação como verificada.</p><button disabled={busy || uncertain} onClick={() => act('IgnorePaymentAlert')}>Verificado</button></div>}
      {manager && !detail.actions?.includes('Settle') && detail.creditProposals?.some(p => !p.decision) && <div className="notice"><p>O cliente propõe utilizar {money(detail.creditProposals.find(p => !p.decision).amount)} de crédito.</p><button className="text-button" disabled={busy || uncertain} onClick={() => act('DeclineCreditProposal', { relatedId: detail.creditProposals.find(p => !p.decision).id })}>Não aplicar esta proposta</button></div>}
      {detail.actions?.includes('DeclarePayment') && <button className="secondary" disabled={busy || uncertain} onClick={() => act('DeclarePayment')}>Comunicar pagamento à terapeuta</button>}
      {detail.actions?.some(a => ['CloseCollection', 'ReopenCollection'].includes(a)) && <form data-protect-draft onSubmit={e => submit(e, f => ({ action: detail.collectionClosed ? 'ReopenCollection' : 'CloseCollection', id: detail.id, version: detail.version, reason: f.get('reason') }))}><h3>{detail.collectionClosed ? 'Reabrir cobrança' : 'Encerrar cobrança sem pagamento'}</h3><label>Justificação{detail.collectionClosed ? ' (opcional)' : ''}<textarea name="reason" required={!detail.collectionClosed} maxLength="2000" /></label><p>A dívida, o valor final e o resultado da consulta mantêm-se.</p><button disabled={busy || uncertain}>{detail.collectionClosed ? 'Reabrir cobrança' : 'Encerrar acompanhamento da cobrança'}</button></form>}
      {manager && detail.collectionHistory?.length > 0 && <details><summary>Histórico da cobrança</summary>{detail.collectionHistory.map(h => <p key={h.id}>{date(h.at)} · {h.closed ? 'Encerrada sem pagamento' : 'Reaberta'} · {h.reason}</p>)}</details>}
      {manager && detail.paymentCommunications?.length > 0 && <details><summary>Comunicações de pagamento</summary>{detail.paymentCommunications.map(h => <p key={h.id}>{date(h.at)} · Comunicação recebida</p>)}</details>}
      {detail.state === 'Requested' && <>{manager && <form onSubmit={e => submit(e, f => ({ action: 'Approve', id: detail.id, version: detail.version, choice: f.get('choice') }))}><label>Método de pagamento para este cliente pagar a consulta<AdaptiveSelect aria-label="Método de pagamento para este cliente pagar a consulta" name="choice" value={approvalChoice || detail.paymentMode} onChange={event => setApprovalChoice(event.target.value)}>{[...new Set([detail.paymentMode, 'Postpayment', 'Gift', 'Credit'])].map(x => <option key={x} value={x}>{labels[x]}</option>)}</AdaptiveSelect></label><button disabled={busy || uncertain}>Aprovar marcação</button></form>}<button className="secondary" disabled={busy || uncertain} onClick={() => act('Reject')}>{manager ? 'Recusar marcação' : 'Desistir do pedido'}</button></>}
      {detail.state === 'Confirmed' && <>{detail.actions?.includes('Accept') && <ConsultationConditionsForm key={`${detail.id}:${detail.version}:${detail.termsVersion}`} consultation={detail} manager={manager} disabled={busy || uncertain} onAccept={values => act('Accept', values)} />}{!manager && <button className="secondary" disabled={busy || uncertain} onClick={() => { if (window.confirm('Confirmas o cancelamento? Não há penalização financeira.')) act('Cancel', { choice: 'Client' }) }}>Cancelar marcação</button>}</>}
      {manager && detail.actions?.includes('Keep') && <button disabled={busy || uncertain} onClick={() => act('Keep')}>Manter o intervalo bloqueado</button>}
      {manager && detail.keepBlocked && <button disabled={busy || uncertain} onClick={() => act('Release')}>Disponibilizar o intervalo cancelado</button>}
      {manager && detail.actions?.includes('Close') && <ConsultationResolution key={'resolution:' + detail.id} detail={detail} people={[{ id: detail.personId, data: { firstName: names.data?.[detail.personId] || 'Ficha de cliente', lastName: '' } }]} disabled={busy || uncertain} guard={guard} submit={submit} onClose={(command, onConfirmed) => send(command, false, onConfirmed)} instant={instant} />}
      {!detail.actions?.includes('Close') && detail.state !== 'Requested' && detail.financialState !== 'Paid' && detail.actions?.includes('Receipt') && <FinancialEntryForm key={'receipt:' + detail.id} people={[{ id: detail.personId, data: { firstName: names.data?.[detail.personId] || 'Ficha de cliente', lastName: '' } }]} consultation={detail} disabled={busy || uncertain} submit={submit} instant={instant} />}
      {manager && detail.state === 'Confirmed' && <ManagerCancellation key={'cancel:' + detail.id} detail={detail} disabled={busy || uncertain} submit={submit} />}
      {manager && detail.financialState === 'ContributionUndefined' && <form onSubmit={e => submit(e, f => ({ action: 'DefineContribution', id: detail.id, version: detail.version, amount: Number(f.get('amount')) }))}><label>Contribuição final decidida pelo cliente<input name="amount" type="number" min="0.01" step="0.01" required /></label><button disabled={busy || uncertain}>Fixar contribuição definitivamente</button></form>}
      {manager && detail.actions?.includes('UseCreditForAdvance') && <button className="secondary" disabled={busy || uncertain} onClick={() => act('UseCreditForAdvance')}>Validar crédito disponível para o pré-pagamento</button>}
      {manager && detail.actions?.includes('Settle') && <CreditSettlementForm key={detail.id} record={detail} manager disabled={busy || uncertain} act={act} />}
      {detail.state === 'Performed' && (manager || followup) && <>{detail.photoIds?.map((id, index) => <img key={id} src={`/api/consultations/${detail.id}/photos/${id}`} alt={`Fotografia partilhada ${index + 1}`} style={{ maxWidth: '100%', height: 'auto' }} />)}<h3>Informação partilhada</h3><div className="shared-consultation-note">{detail.sharedNote || 'Sem notas partilhadas.'}</div>{!manager && detail.section === 'Closed' && !detail.archivedAt && <button disabled={busy || uncertain} onClick={() => act('Archive', { publicContentVersion: detail.publicContentVersion })}>Já vi a informação sobre a consulta, posso arquivar.</button>}</>}
      {manager && detail.privateNote && <><h3>Nota privada — apenas gestão</h3><p className="shared-consultation-note">{detail.privateNote}</p></>}
      {!manager && detail.state === 'Performed' && !followup && <button className="text-button" onClick={() => setFollowup(true)}>Ver consulta e acompanhamento com a terapeuta</button>}
      {manager && detail.state === 'Performed' && <ConsultationConversation key={'conversation:' + detail.id} id={detail.id} manager />}
    </ConsultationDialog>}
    </div>
    {clientProfileId && <><button type="button" className="secondary" onClick={() => guard(() => setClientProfileId(null))}>Voltar à confirmação do agendamento</button><Clients initialId={clientProfileId} busy={busy || profileBusy} perform={perform} notify={notify} guard={guard} /></>}
  </section>
}


function ManagerCancellation({ detail, disabled, submit }) {
  const [open, setOpen] = useState(false)
  if (!open) return <button type="button" className="secondary" disabled={disabled} onClick={() => setOpen(true)}>Cancelar agendamento</button>
  return <form data-protect-draft onSubmit={event => submit(event, fields => ({ action: 'Cancel', id: detail.id, version: detail.version, choice: fields.get('origin'), availabilityChoice: fields.get('availability') }))}>
    <label>Origem do cancelamento<AdaptiveSelect name="origin"><option value="Management">Decisão da terapeuta</option><option value="Client">Pedido do cliente</option></AdaptiveSelect></label>
    <AvailabilityChoice />
    <button type="button" className="secondary" disabled={disabled} onClick={() => setOpen(false)}>Voltar</button>
    <button className="secondary" disabled={disabled}>Cancelar agendamento</button>
  </form>
}

function AvailabilityChoice() {
  return <label>Disponibilidade após cancelar<AdaptiveSelect name="availability" required defaultValue=""><option value="">Escolhe o destino do horário</option><option value="Release">Libertar o horário</option><option value="Keep">Manter bloqueado</option></AdaptiveSelect></label>
}
