import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import styles from './Consultations.module.css'
import InformationCard from './InformationCard'
import CardGrid from './CardGrid'
import SummaryCard from './SummaryCard'
import AppointmentCard from './AppointmentCard'
import useLiveResource from './useLiveResource'
import useClientOptions from './useClientOptions'
import useConsultationNames from './useConsultationNames'
import FinancePanel, { FinancialEntryForm } from './FinancePanel'
import AgendaSetup from './AgendaSetup'
import AgendaCalendar from './AgendaCalendar'
import BookingForm from './BookingForm'
import ClientFinance from './ClientFinance'
import ClosureForm from './ClosureForm'
import ConsultationDialog from './ConsultationDialog'
import GuestRequests from './GuestRequests'
import SessionPacksPanel from './SessionPacksPanel'
import GroupEventsPanel from './GroupEventsPanel'
import ConsultationNoteEditor from './ConsultationNoteEditor'
import ConsultationConversation from './ConsultationConversation'
import ManagerAgenda from './ManagerAgenda'
import ManagerSchedulingDialog from './ManagerSchedulingDialog'
import ManualBookingForm from './ManualBookingForm'
import AvailabilityEditorForm from './AvailabilityEditorForm'
import { addDays, agendaMoney as money, agendaDate as date, localDate as lisbonParts, instant } from './agendaTime'

const labels = { Requested: 'A aguardar confirmação', Confirmed: 'Confirmada', AwaitingClosure: 'A aguardar fecho', Performed: 'Realizada', NoShow: 'Não compareceu', CancelledClient: 'Cancelada pelo cliente', CancelledManager: 'Cancelada pela terapeuta', Rejected: 'Recusada', Expired: 'Expirada', ConditionsPending: 'Por validar condições', AwaitingReceipt: 'Aguarda recebimento', ContributionUndefined: 'Por pagar — contribuição por definir', ContributionPending: 'Por pagar — contribuição pendente', Unpaid: 'Por pagar', Paid: 'Paga', NoDebt: 'Sem dívida', Prepayment: 'Pré-pagamento', Postpayment: 'Pagamento posterior', Contribution: 'Contribuição livre', Free: 'Gratuita', Gift: 'Oferta de pagamento', Credit: 'Usar crédito (sem desconto antecipado)', Receipt: 'Recebimento', Settlement: 'Liquidação', Reversal: 'Anulação integral' }
const clientName = person => [person.data.firstName, person.data.lastName].filter(Boolean).join(' ')

export default function Consultations({ manager, area, initialEntry, onCreateClient, onFollowup, guard = action => action() }) {
  const managementAgenda = manager && area === 'Agenda'
  const [section, setSection] = useState(area === 'Consultations' ? 'Closure' : manager ? 'Upcoming' : 'Payments')
  const [view, setView] = useState(initialEntry?.packs ? 'Packs' : initialEntry?.events ? 'Events' : initialEntry?.guests ? 'Guests' : area === 'Agenda' && !manager && !initialEntry?.payments ? 'Calendar' : 'List')
  const [booking, setBooking] = useState(null)
  const [managerDialog, setManagerDialog] = useState(null)
  const [dialogWorking, setDialogWorking] = useState(false)
  const [domainEntry, setDomainEntry] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState('')
  const [searching, setSearching] = useState(false)
  const [detail, setDetail] = useState(null)
  const [followup, setFollowup] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const pending = useRef(null)
  const pendingCleanup = useRef(null)
  const readList = useCallback(signal => apiRequest(`consultations?section=${section}&page=${page}&search=${searching}${!manager && section === 'Closed' ? '&state=NoShow' : ''}${filters}`, undefined, { signal }), [section, page, searching, filters, manager])
  const list = useLiveResource('consultations', `${area}|${section}|${page}|${searching}|${filters}`, readList, area !== 'Finance' && !managementAgenda && view === 'List')
  const result = list.data
  const names = useConsultationNames(view === 'List' ? result?.items || [] : [], detail, manager)
  const readSetup = useCallback(signal => apiRequest(manager ? 'consultations/setup' : 'consultations/availability', undefined, { signal }), [manager])
  const agenda = useLiveResource('agenda', manager ? 'management' : 'availability', readSetup, area === 'Agenda' && (['Setup', 'Booking'].includes(view) || !!managerDialog))
  const setup = agenda.data
  const customers = useClientOptions(manager && (view === 'List' && filtersOpen || view === 'Booking'))
  const people = customers.data || []
  const detailId = detail?.id
  const readDetail = useCallback(signal => apiRequest('consultations/' + detailId, undefined, { signal }), [detailId])
  const latestDetail = useLiveResource('consultations', 'detail:' + detailId, readDetail, !!detailId)
  useEffect(() => {
    if (!initialEntry || initialEntry.payments || initialEntry.guests || initialEntry.events || initialEntry.packs) return
    let current = true
    apiRequest('consultations/' + initialEntry.id).then(value => { if (current) setDetail(value) }).catch(failure => { if (current) setError(failure.message) })
    return () => { current = false }
  }, [initialEntry])
  async function send(command, retry = false, onConfirmed = null, onRejected = null) {
    if (busy) return
    if (!navigator.onLine) { setError('Sem ligação. O preenchimento foi mantido. Volta a tentar quando tiveres rede.'); return }
    if (pending.current && !retry) { setError('Confirma primeiro o resultado da operação anterior, repetindo apenas essa mesma operação.'); return }
    const input = retry ? pending.current : { ...command, operationId: crypto.randomUUID() }
    if (!input) return
    if (!retry) pendingCleanup.current = onConfirmed
    pending.current = input; setBusy(true); setError(''); setMessage('')
    try {
      const response = await apiRequest('consultations/commands', input)
      pending.current = null; setUncertain(false); setMessage(response.message)
      const cleanup = pendingCleanup.current; pendingCleanup.current = null
      if (cleanup) { try { await cleanup() } catch (failure) { setError('A operação foi confirmada no servidor, mas a cópia local foi conservada: ' + failure.message) } }
      if (detail) {
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
  async function open(id, notes = false) { try { setDetail(await apiRequest('consultations/' + id)); setFollowup(notes); setError('') } catch (failure) { setError(failure.message) } }
  function openDomain(kind, id) { guard(() => { setDomainEntry({ kind, id }); setView(kind === 'Pack' ? 'Packs' : 'Events') }) }
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
  return <section className={styles.page} data-pending-command={busy || uncertain ? 'true' : undefined}>
    {(!managementAgenda || view !== 'List') && <><h1>{area === 'Finance' ? 'Financeiro' : area === 'Consultations' ? 'Consultas' : view === 'Setup' ? 'Construir e editar agenda' : view === 'Booking' ? 'Agendamento manual' : 'Agenda'}</h1><p>Datas e horas de Lisboa.</p></>}
    {managementAgenda && view !== 'List' && <button className="text-button" disabled={busy || uncertain} onClick={() => guard(() => setView('List'))}>← Voltar à agenda</button>}
    {!detail && !managerDialog && !['Guests', 'Packs', 'Events'].includes(view) && feedback}
    {customers.error && <InformationCard error={customers.error} onRetry={customers.refresh} cardId="customer-options-error" />}
    {names.error && <InformationCard error={names.error} onRetry={names.refresh} cardId="consultation-names-error" />}
    {area !== 'Finance' && agenda.error && <InformationCard error={agenda.error} onRetry={agenda.refresh} cardId="agenda-error" />}
    {manager && area !== 'Finance' && !managementAgenda && view === 'List' && <details className={styles.filters} onToggle={event => setFiltersOpen(event.currentTarget.open)}><summary>Pesquisar consultas</summary><form onSubmit={e => {
      e.preventDefault(); try {
        const f = new FormData(e.currentTarget); const q = new URLSearchParams()
        for (const name of ['personId', 'state', 'financial', 'sort', 'hasNotes']) if (f.get(name)) q.set(name, f.get(name))
        if (f.get('from')) q.set('from', instant(f.get('from')))
        if (f.get('to')) q.set('to', instant(f.get('to')))
        setFilters('&' + q.toString()); setSearching(f.has('global')); setPage(1); setView('List')
      } catch (failure) { setError(failure.message) }
    }}><label className="checkbox"><input name="global" type="checkbox" />Pesquisa global, independente dos separadores</label>
      <label>Cliente<select name="personId"><option value="">Todos</option>{people.map(p => <option key={p.id} value={p.id}>{clientName(p)}</option>)}</select></label>
      <label>Estado<select name="state"><option value="">Todos</option>{['Requested', 'Confirmed', 'AwaitingClosure', 'Performed', 'NoShow', 'CancelledClient', 'CancelledManager', 'Rejected', 'Expired'].map(v => <option key={v} value={v}>{labels[v]}</option>)}</select></label>
      <label>Situação financeira<select name="financial"><option value="">Todas</option>{['Unpaid', 'ContributionUndefined', 'ContributionPending', 'Paid', 'NoDebt', 'AwaitingReceipt'].map(v => <option key={v} value={v}>{labels[v]}</option>)}<option value="CollectionClosed">Cobrança encerrada sem pagamento</option></select></label>
      <label>Desde (Lisboa)<input name="from" type="datetime-local" /></label><label>Até, exclusivo (Lisboa)<input name="to" type="datetime-local" /></label>
      <label>Notas<select name="hasNotes"><option value="">Com ou sem notas</option><option value="true">Com notas</option><option value="false">Sem notas</option></select></label>
      <label>Ordenação<select name="sort"><option value="">Inicial do separador</option><option value="Oldest">Mais antigas primeiro</option><option value="Newest">Mais recentes primeiro</option></select></label><button>Pesquisar</button>{searching && <p>Resultados da pesquisa global — não é um novo estado.</p>}
    </form></details>}
    {managementAgenda && <div hidden={view !== 'List'}><ManagerAgenda enabled={view === 'List'} disabled={busy || uncertain}
      onSetup={() => guard(() => { setError(''); setMessage(''); setManagerDialog('Availability') })} onBooking={() => guard(() => { setError(''); setMessage(''); setBooking(null); setManagerDialog('Manual') })}
      onOpen={row => guard(() => {
        if (row.kind === 'Consultation') return open(row.id)
        setDomainEntry({ kind: row.kind === 'Guest' ? 'Guest' : 'Event', id: row.sourceId, participationId: row.kind === 'Participation' ? row.id : null, revision: Date.now() })
        setView(row.kind === 'Guest' ? 'Guests' : 'Events')
      })} /></div>}
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
    {['Agenda', 'Finance'].includes(area) && view === 'Events' && <GroupEventsPanel manager={manager} send={send} disabled={busy || uncertain} guard={guard} feedback={feedback} initialEntry={domainEntry?.kind === 'Event' ? { ...domainEntry, events: true } : initialEntry} />}
    {area === 'Agenda' && manager && view === 'Guests' && <GuestRequests send={send} disabled={busy || uncertain} guard={guard} onCreateClient={onCreateClient} feedback={feedback} initialId={domainEntry?.kind === 'Guest' ? domainEntry.id : null} />}
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
          publish={(command, cleanup, rejected) => send(command, false, cleanup, rejected)} onBack={() => guard(() => setManagerDialog(null))} onSaved={() => setManagerDialog(null)} onTools={() => guard(() => { setManagerDialog(null); setView('Setup') })} />)}
    </ManagerSchedulingDialog>}
    {area === 'Finance' && (['Packs', 'Events'].includes(view) ? <button className="secondary" disabled={busy || uncertain} onClick={() => guard(() => { setDomainEntry(null); setView('List') })}>Voltar ao financeiro</button> : <FinancePanel guard={guard} disabled={busy || uncertain} submit={submit} open={open} instant={instant} onOpenDomain={openDomain} />)}
    {view === 'List' && area !== 'Finance' && !managementAgenda && <>
      <nav className="consultation-tabs" aria-label="Separadores de consultas">{tabs.map(([key, text]) => <button key={key} className={section === key ? '' : 'secondary'} aria-pressed={section === key} onClick={() => guard(() => { setSection(key); setPage(1); setSearching(false) })}>{text}</button>)}</nav>
      {!manager && section === 'Payments' && <ClientFinance onOpenDomain={openDomain} />}
      <InformationCard className={styles.results} cardId="consultation-results" loading={list.loading} refreshing={list.refreshing} error={list.error} onRetry={list.refresh}>{result && <>
        <SummaryCard cardId="consultation-count" label={searching ? 'Resultados da pesquisa' : tabs.find(([key]) => key === section)?.[1]} value={result.total} icon="calendar" />
        <CardGrid>{result.items.map(c => <AppointmentCard key={c.id} consultation={c} clientName={manager ? names.data?.[c.personId] || (names.loading ? 'A consultar o nome do cliente…' : 'Ficha de cliente') : null} stateLabel={labels[c.state]} financialLabel={labels[c.financialState]} actionLabel={section === 'Payments' ? 'Abrir pagamento' : 'Abrir consulta'} onOpen={open} />)}</CardGrid>
        {result.total === 0 && <p>Não há consultas neste separador.</p>}<div className="consultation-tabs"><button disabled={page === 1} onClick={() => setPage(x => x - 1)}>Anterior</button><span>Página {page}</span><button disabled={page * 8 >= result.total} onClick={() => setPage(x => x + 1)}>Seguinte</button></div>
      </>}</InformationCard>
    </>}
    {detail && <ConsultationDialog onClose={closeDetail} disabled={busy || uncertain}><h2>{detail.serviceTitle}</h2><p>{date(detail.startsAt)} — {date(detail.endsAt)}</p><p>{labels[detail.state]} · {labels[detail.financialState]}</p><p>{detail.publicLocation} · {detail.modality === 'Remote' ? 'Remota' : 'Presencial'}</p>
      {manager && <p>{names.data?.[detail.personId] || (names.loading ? 'A consultar o nome do cliente…' : 'Ficha de cliente')}</p>}
      {feedback}
      {latestDetail.error && <p className="notice error" role="status">Não foi possível atualizar esta consulta. Os campos em edição foram mantidos.</p>}
      {latestDetail.data && latestDetail.data.version !== detail.version && <p className="notice" role="status">Esta consulta foi alterada. Os teus campos não foram substituídos. Fecha e volta a abrir para rever a informação antes de guardar.</p>}
      {(!followup || manager) && <><p>Referência: {money(detail.referencePrice)} · Valor final: {money(detail.finalAmount)}</p><p>Crédito disponível: {money(detail.balance)}</p>{detail.instructions && <p>{detail.instructions}</p>}</>}
      {detail.advanceSatisfiedAt && <p>Condição de antecipação satisfeita. O saldo não ficou reservado.</p>}
      {detail.collectionClosed && <div className="notice"><p>Por pagar — Cobrança encerrada</p><p>Para regularizar esta consulta, contacta diretamente a terapeuta.</p></div>}
      {manager && detail.paymentAlert && <div className="notice"><p>Comunicação de pagamento do cliente</p><p>Confirma o recebimento no formulário abaixo ou ignora este alerta sem alterar o saldo.</p><button disabled={busy || uncertain} onClick={() => act('IgnorePaymentAlert')}>Ignorar alerta</button></div>}
      {detail.actions?.includes('DeclarePayment') && <button className="secondary" disabled={busy || uncertain} onClick={() => act('DeclarePayment')}>Comunicar pagamento à terapeuta</button>}
      {detail.actions?.some(a => ['CloseCollection', 'ReopenCollection'].includes(a)) && <form data-protect-draft onSubmit={e => submit(e, f => ({ action: detail.collectionClosed ? 'ReopenCollection' : 'CloseCollection', id: detail.id, version: detail.version, reason: f.get('reason') }))}><h3>{detail.collectionClosed ? 'Reabrir cobrança' : 'Encerrar cobrança sem pagamento'}</h3><label>Justificação{detail.collectionClosed ? ' (opcional)' : ''}<textarea name="reason" required={!detail.collectionClosed} maxLength="2000" /></label><p>A dívida, o valor final e o resultado da consulta mantêm-se.</p><button disabled={busy || uncertain}>{detail.collectionClosed ? 'Reabrir cobrança' : 'Encerrar acompanhamento da cobrança'}</button></form>}
      {manager && detail.collectionHistory?.length > 0 && <details><summary>Histórico da cobrança</summary>{detail.collectionHistory.map(h => <p key={h.id}>{date(h.at)} · {h.closed ? 'Encerrada sem pagamento' : 'Reaberta'} · {h.reason}</p>)}</details>}
      {manager && detail.paymentCommunications?.length > 0 && <details><summary>Comunicações de pagamento</summary>{detail.paymentCommunications.map(h => <p key={h.id}>{date(h.at)} · Comunicação recebida</p>)}</details>}
      {detail.state === 'Requested' && <>{manager && <form onSubmit={e => submit(e, f => ({ action: 'Approve', id: detail.id, version: detail.version, choice: f.get('choice') }))}><label>Tratamento financeiro<select name="choice" defaultValue={detail.paymentMode}>{[...new Set([detail.paymentMode, 'Postpayment', 'Gift', 'Credit'])].map(x => <option key={x} value={x}>{labels[x]}</option>)}</select></label><button disabled={busy || uncertain}>Aprovar marcação</button></form>}<button className="secondary" disabled={busy || uncertain} onClick={() => act('Reject')}>{manager ? 'Recusar pedido' : 'Desistir do pedido'}</button></>}
      {detail.state === 'Confirmed' && <>{detail.expectationOpen && !detail.acceptedAt && <form onSubmit={e => submit(e, f => ({ action: 'Accept', id: detail.id, version: detail.version, conditionsAccepted: f.has('accept'), termsVersion: detail.termsVersion, reason: f.get('reason') }))}><p>{detail.terms}</p><label className="checkbox"><input name="accept" type="checkbox" />Li e aceito as condições.</label>{manager && <label>Como foi comunicada a aceitação?<input name="reason" required maxLength="1000" /></label>}<button disabled={busy || uncertain}>Aceito as condições. De seguida farei este pagamento.</button></form>}{manager ? <form data-protect-draft onSubmit={e => submit(e, f => ({ action: 'Cancel', id: detail.id, version: detail.version, choice: f.get('origin'), availabilityChoice: f.get('availability') }))}><label>Origem do cancelamento<select name="origin"><option value="Management">Decisão da terapeuta</option><option value="Client">Pedido do cliente</option></select></label><AvailabilityChoice /><button className="secondary" disabled={busy || uncertain}>Confirmar cancelamento</button></form> : <button className="secondary" disabled={busy || uncertain} onClick={() => { if (window.confirm('Confirmas o cancelamento? Não há penalização financeira.')) act('Cancel', { choice: 'Client' }) }}>Cancelar marcação</button>}</>}
      {manager && detail.actions?.includes('Keep') && <button disabled={busy || uncertain} onClick={() => act('Keep')}>Manter o intervalo bloqueado</button>}
      {manager && detail.keepBlocked && <button disabled={busy || uncertain} onClick={() => act('Release')}>Disponibilizar o intervalo cancelado</button>}
      {manager && (detail.actions?.includes('Close') || initialEntry?.recoverScope?.startsWith('closure:')) && <ClosureForm key={detail.id} detail={detail} disabled={busy || uncertain} onClose={(command, onConfirmed) => send(command, false, onConfirmed)} instant={instant} canClose={detail.actions?.includes('Close')} />}
      {detail.actions?.includes('Receipt') && <FinancialEntryForm key={detail.id} people={[{ id: detail.personId, data: { firstName: names.data?.[detail.personId] || 'Ficha de cliente', lastName: '' } }]} consultation={detail} disabled={busy || uncertain} submit={submit} instant={instant} />}
      {manager && detail.financialState === 'ContributionUndefined' && <form onSubmit={e => submit(e, f => ({ action: 'DefineContribution', id: detail.id, version: detail.version, amount: Number(f.get('amount')) }))}><label>Contribuição final decidida pelo cliente<input name="amount" type="number" min="0.01" step="0.01" required /></label><button disabled={busy || uncertain}>Fixar contribuição definitivamente</button></form>}
      {detail.actions?.includes('Settle') && <><button disabled={busy || uncertain || detail.balance < detail.finalAmount} onClick={() => { if (window.confirm(`Liquidar integralmente ${money(detail.finalAmount)} com crédito?`)) act('Settle') }}>Pagar integralmente com crédito</button></>}
      {detail.state === 'Performed' && (manager || followup) && <><h3>Informação partilhada</h3><div className="shared-consultation-note">{detail.sharedNote || 'Sem notas partilhadas.'}</div>{detail.photoIds?.map((id, index) => <img key={id} src={`/api/consultations/${detail.id}/photos/${id}`} alt={`Fotografia partilhada ${index + 1}`} style={{ maxWidth: '100%', height: 'auto' }} />)}{!manager && detail.section === 'Closed' && !detail.archivedAt && <button disabled={busy || uncertain} onClick={() => act('Archive', { publicContentVersion: detail.publicContentVersion })}>Já vi a informação sobre a consulta, posso arquivar.</button>}</>}
      {manager && detail.state === 'Performed' && <ConsultationNoteEditor key={'shared:' + detail.id} detail={detail} kind="Shared" send={send} disabled={busy || uncertain} recoverScope={initialEntry?.recoverScope} />}
      {manager && detail.closedAt && <ConsultationNoteEditor key={'private:' + detail.id} detail={detail} kind="Private" send={send} disabled={busy || uncertain} recoverScope={initialEntry?.recoverScope} />}
      {manager && detail.state === 'Performed' && <ConsultationConversation key={'conversation:' + detail.id} id={detail.id} title={detail.serviceTitle} manager />}
      {manager && detail.privateNote && <><h3>Nota privada — apenas gestão</h3><p className="shared-consultation-note">{detail.privateNote}</p></>}
      {!manager && detail.state === 'Performed' && !followup && <button className="text-button" onClick={() => onFollowup ? onFollowup(detail.id) : setFollowup(true)}>Ver consulta e acompanhamento com a terapeuta</button>}
    </ConsultationDialog>}
  </section>
}


function AvailabilityChoice() {
  return <label>Disponibilidade após cancelar<select name="availability" required defaultValue=""><option value="">Escolhe o destino do horário</option><option value="Release">Libertar o horário</option><option value="Keep">Manter bloqueado</option></select></label>
}
