import DateRangeFields from './DateRangeFields'
import AdaptiveSelect from './AdaptiveSelect'
import { announceOperation, dismissSuccess } from './actionNotices'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import styles from './Consultations.module.css'
import InformationCard from './InformationCard'
import CardGrid from './CardGrid'
import SummaryCard from './SummaryCard'
import AppointmentCard from './AppointmentCard'
import EventCardInfo from './EventCardInfo'
import useLiveResource from './useLiveResource'
import ClientSearch from './ClientSearch'
import useConsultationNames from './useConsultationNames'
import Clients from './Clients'
import FinancePanel, { FinancialEntryForm } from './FinancePanel'
import CreditSettlementForm from './CreditSettlementForm'
import CreditAuthorizationCard from './CreditAuthorizationCard'
import ConsultationPaymentHistory from './ConsultationPaymentHistory'
import ConsultationResolution from './ConsultationResolution'
import ConsultationDialog from './ConsultationDialog'
import AppointmentSummary from './AppointmentSummary'
import Pagination from './Pagination'
import ConsultationLocation from './ConsultationLocation'
import ConsultationValue from './ConsultationValue'
import ConsultationStatus from './ConsultationStatus'
import labels from './consultationLabels'
import ConsultationConditionsForm from './ConsultationConditionsForm'
import GuestRequests from './GuestRequests'
import SessionPacksPanel from './SessionPacksPanel'
import GroupEventsPanel from './GroupEventsPanel'
import { ClosureAttachmentList } from './ClosureAttachments'
import ConsultationConversation from './ConsultationConversation'
import ManagerAgenda from './ManagerAgenda'
import ManagerVisitorAgenda from './ManagerVisitorAgenda'
import ManagerGoogleAgenda from './ManagerGoogleAgenda'
import ManagerSchedulingDialog from './ManagerSchedulingDialog'
import ManualBookingForm from './ManualBookingForm'
import WhatsAppMessage from './WhatsAppMessage'
import AvailabilityEditorForm from './AvailabilityEditorForm'
import { agendaMoney as money, agendaDate as date, instant, setDateRangeParams } from './agendaTime'

const activityStates = { Waiting: 'Em espera', Withdrawn: 'Desistiu durante o retiro', Cancelled: 'Cancelada' }
const domainFromEntry = entry => entry?.events ? { kind: 'Event', ...entry } : entry?.packs ? { kind: 'Pack', ...entry } : entry?.guests ? { kind: 'Guest', ...entry } : null

export default function Consultations({ manager, area, initialEntry, onCreateClient, perform, notify, profileBusy = false, guard = action => action() }) {
  const managementAgenda = manager && area === 'Agenda'
  const [section, setSection] = useState(area === 'Consultations' ? 'Closure' : manager ? 'Upcoming' : 'Payments')
  const [managerDialog, setManagerDialog] = useState(null)
  const [agendaView, setAgendaView] = useState(null)
  const agendaReturn = useRef(null)
  const [dialogWorking, setDialogWorking] = useState(false)
  const [domainEntry, setDomainEntry] = useState(() => domainFromEntry(initialEntry))
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
  const list = useLiveResource('consultations', `${area}|${section}|${page}|${searching}|${filters}`, readList, area === 'Consultations')
  const result = list.data
  useEffect(() => {
    const entry = domainFromEntry(initialEntry)
    if (!entry) return
    const timer = window.setTimeout(() => setDomainEntry(entry), 0)
    return () => window.clearTimeout(timer)
  }, [initialEntry])
  useEffect(() => {
    if (!result || list.error || page <= Math.max(1, Math.ceil(result.total / 8))) return
    const correction = window.setTimeout(() => setPage(Math.max(1, Math.ceil(result.total / 8))), 0)
    return () => window.clearTimeout(correction)
  }, [result, list.error, page])
  const names = useConsultationNames(result?.items || [], detail, manager)
  const readSetup = useCallback(signal => apiRequest(manager ? 'consultations/setup' : 'consultations/availability', undefined, { signal }), [manager])
  const agenda = useLiveResource('agenda', 'management', readSetup, managementAgenda && !!managerDialog)
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
    dismissSuccess(); pending.current = input; setBusy(true); setError(''); setMessage('')
    try {
      const response = await apiRequest('consultations/commands', input)
      if (!response.id) throw new Error('Não foi possível confirmar o resultado da operação. Verifica o resultado antes de continuar.')
      pending.current = null; setUncertain(false); announceOperation(input, response, { client: !manager })
      const cleanup = pendingCleanup.current; pendingCleanup.current = null
      if (cleanup) { try { await cleanup() } catch (failure) { setError('A operação foi confirmada no servidor, mas não foi possível atualizar o formulário: ' + failure.message) } }
      if (manager && ['Approve', 'Close', 'Receipt', 'MoveToOldDebts'].includes(input.action)) {
        setDetail(null); setApprovalChoice('')
      } else if (detail) {
        try {
          const current = await apiRequest('consultations/' + detail.id)
          setDetail(current)
          return { ...response, resourceVersion: current.version }
        }
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
        else setMessage('As alterações que fizeste durante o envio foram mantidas e ainda não foram guardadas.')
        return { ...response, editorUnchanged }
      })
    } catch (failure) { setError(failure.message); return Promise.resolve(null) }
  }
  async function open(id, notes = false) { try { const value = await apiRequest('consultations/' + id); detailDirty.current = false; setDetail(value); setApprovalChoice(''); setFollowup(notes); setError('') } catch (failure) { setError(failure.message) } }
  function openDomain(kind, id) { guard(() => setDomainEntry({ kind: kind === 'Pack' ? 'Pack' : 'Event', id, revision: Date.now() })) }
  function openManagementRow(row) {
    if (!row.kind || row.kind === 'Consultation') return open(row.id)
    setDomainEntry({ kind: row.kind === 'Guest' ? 'Guest' : 'Event', id: row.sourceId, participationId: row.kind === 'Participation' ? row.id : null, revision: Date.now() })
  }
  function openAgendaView(view, trigger) {
    guard(() => {
      agendaReturn.current = { trigger, scroll: window.scrollY }
      setError(''); setMessage(''); setAgendaView(view)
      window.scrollTo(0, 0)
    })
  }
  function closeAgendaView() {
    const origin = agendaReturn.current
    setAgendaView(null)
    requestAnimationFrame(() => {
      origin?.trigger.focus({ preventScroll: true })
      window.scrollTo(0, origin?.scroll || 0)
    })
  }
  async function closeDetail() {
    if (busy || uncertain) return
    if (document.querySelector('.consultation-dialog [data-pending-command="true"]')) { setError('Confirma o resultado da operação antes de fechar.'); return }
    await guard(() => setDetail(null))
  }
  const act = (action, values = {}) => send({ action, id: detail.id, version: detail.version, ...values })
  const tabs = area === 'Consultations' ? [['Closure', 'Por fechar'], ['Performed', 'Realizadas'], ['NoShow', 'Não compareceu'], ['Cancelled', 'Canceladas/expiradas']]
    : manager ? [['Requests', 'Pedidos por validar'], ['AwaitingReceipt', 'A aguardar recebimento'], ['Upcoming', 'Próximas consultas'], ['Ended', 'Recusados e expirados']]
      : [['Payments', 'Pagamentos pendentes'], ['Upcoming', 'Próximas consultas'], ['Other', 'Consultas pendentes e canceladas'], ['Closed', 'Não compareceu']]
  const feedback = <>{error && <p role="alert" className="notice error">{error}</p>}{message && <p role="status" className="notice">{message}</p>}
    {uncertain && <button disabled={busy} onClick={() => send(null, true)}>Verificar resultado</button>}</>
  return <section className={styles.page} data-pending-command={busy || uncertain ? 'true' : undefined} onChangeCapture={event => { if (event.target.closest('dialog form')) detailDirty.current = true }}>
    <div hidden={!!clientProfileId}>
    {!managementAgenda && <h1>{area === 'Finance' ? 'Financeiro' : 'Consultas'}</h1>}
    {!detail && !managerDialog && !domainEntry && feedback}
    {names.error && <InformationCard error={names.error} onRetry={names.refresh} cardId="consultation-names-error" />}
    {area !== 'Finance' && agenda.error && <InformationCard error={agenda.error} onRetry={agenda.refresh} cardId="agenda-error" />}
    {manager && area === 'Consultations' && <details className={styles.filters}><summary>Pesquisar consultas</summary><form className={styles.filterFields} onSubmit={e => {
      e.preventDefault(); try {
        const f = new FormData(e.currentTarget); const q = new URLSearchParams()
        for (const name of ['personId', 'state', 'financial', 'sort', 'hasNotes']) if (f.get(name)) q.set(name, f.get(name))
        setDateRangeParams(q, f.get('from'), f.get('to'))
        setFilters('&' + q.toString()); setSearching(f.has('global')); setPage(1)
      } catch (failure) { setError(failure.message) }
    }}><label className={`checkbox ${styles.filterWide}`}><input name="global" type="checkbox" defaultChecked />Pesquisa global, independente dos separadores</label>
      <label>Estado<AdaptiveSelect name="state"><option value="">Todos</option>{['Requested', 'Confirmed', 'AwaitingClosure', 'Performed', 'NoShow', 'Withdrawn', 'CancelledClient', 'CancelledManager', 'Rejected', 'Expired', 'Waiting', 'Cancelled'].map(v => <option key={v} value={v}>{labels[v] || activityStates[v]}</option>)}</AdaptiveSelect></label>
      <label>Situação financeira<AdaptiveSelect name="financial"><option value="">Todas</option>{['Unpaid', 'ContributionUndefined', 'ContributionPending', 'Paid', 'NoDebt', 'AwaitingReceipt'].map(v => <option key={v} value={v}>{labels[v]}</option>)}<option value="OldDebt">Dívidas antigas</option></AdaptiveSelect></label>
      <DateRangeFields type="date" startName="from" endName="to" startLabel="Desde" endLabel="Até" />
      <label>Notas<AdaptiveSelect name="hasNotes"><option value="">Com ou sem notas</option><option value="true">Com notas</option><option value="false">Sem notas</option></AdaptiveSelect></label>
      <label>Ordenação<AdaptiveSelect name="sort"><option value="">Inicial do separador</option><option value="Oldest">Mais antigas primeiro</option><option value="Newest">Mais recentes primeiro</option></AdaptiveSelect></label>
      <div className={styles.filterWide}><ClientSearch purpose="filter" selected={filterClient} onSelect={setFilterClient} disabled={busy || uncertain} /></div>
      <button className={styles.filterWide} disabled={busy || uncertain}>Pesquisar</button>{searching && <p className={styles.filterWide}>Resultados de consultas individuais, pedidos, grupos, oficinas e retiros.</p>}
    </form></details>}
    {managementAgenda && agendaView === 'Visitor' && <ManagerVisitorAgenda onBack={closeAgendaView} />}
    {managementAgenda && agendaView === 'Google' && <ManagerGoogleAgenda onBack={closeAgendaView} guard={guard}
      busy={busy || uncertain} onOpen={row => guard(() => openManagementRow(row))} />}
    {managementAgenda && <div hidden={!!agendaView}><ManagerAgenda enabled={!agendaView} disabled={busy || uncertain}
      onVisitorView={event => openAgendaView('Visitor', event.currentTarget)}
      onGoogleView={event => openAgendaView('Google', event.currentTarget)}
      onSetup={() => guard(() => { setError(''); setMessage(''); setManagerDialog('Availability') })} onBooking={() => guard(() => { setError(''); setMessage(''); setManagerDialog('Manual') })}
      onOpen={row => guard(() => openManagementRow(row))} /></div>}
    {domainEntry?.kind === 'Pack' && <SessionPacksPanel dialogOnly manager={manager} send={send} disabled={busy || uncertain} guard={guard} feedback={feedback} initialId={domainEntry.id} onClose={() => setDomainEntry(null)} />}
    {domainEntry?.kind === 'Event' && <GroupEventsPanel manager={manager} send={send} disabled={busy || uncertain} guard={guard} feedback={feedback} initialEntry={{ ...domainEntry, events: true }} onClose={() => setDomainEntry(null)} />}
    {domainEntry?.kind === 'Guest' && manager && <GuestRequests send={send} disabled={busy || uncertain} guard={guard} onCreateClient={onCreateClient} feedback={feedback} initialId={domainEntry.id} onClose={() => setDomainEntry(null)} />}
    {managementAgenda && managerDialog && <ManagerSchedulingDialog title={managerDialog === 'Manual' ? 'Marcação manual' : 'Editar agenda'} disabled={busy || uncertain || dialogWorking} onClose={() => guard(() => setManagerDialog(null))}>
      {agenda.loading && <p role="status">A carregar os dados da agenda…</p>}
      {agenda.error && <div className="notice error" role="alert"><p>{agenda.error}</p><button className="secondary" onClick={agenda.refresh}>Voltar a tentar</button></div>}
      {setup && (managerDialog === 'Manual' ? <ManualBookingForm setup={setup} disabled={busy || uncertain} feedback={feedback} onWorking={setDialogWorking} onReviewStart={() => { setError(''); setMessage('') }}
        publish={(command, cleanup, rejected) => send(command, false, cleanup, rejected)} onBack={() => guard(() => setManagerDialog(null))} onSaved={() => setManagerDialog(null)} />
        : <AvailabilityEditorForm setup={setup} disabled={busy || uncertain} feedback={feedback} refresh={agenda.refresh} onWorking={setDialogWorking} onReviewStart={() => { setError(''); setMessage('') }}
          publish={(command, cleanup, rejected) => send(command, false, cleanup, rejected)} onBack={() => guard(() => setManagerDialog(null))} onSaved={() => setManagerDialog(null)} />)}
    </ManagerSchedulingDialog>}
    {area === 'Finance' && <FinancePanel guard={guard} disabled={busy || uncertain || profileBusy} submit={submit} send={send} feedback={feedback}
      clearFeedback={() => { setError(''); setMessage('') }} perform={perform} notify={notify} open={open} instant={instant} onOpenDomain={openDomain} />}
    {area === 'Consultations' && <>
      <nav className="consultation-tabs" aria-label="Separadores de consultas">{tabs.map(([key, text]) => <button key={key} className={section === key ? '' : 'secondary'} aria-pressed={section === key} onClick={() => guard(() => { setSection(key); setPage(1); setSearching(false) })}>{text}</button>)}</nav>
      <InformationCard variant="plain" cardId="consultation-results" loading={list.loading} refreshing={list.refreshing} error={list.error} onRetry={list.refresh}>{result && <>
        <SummaryCard cardId="consultation-count" label={searching ? 'Resultados da pesquisa' : tabs.find(([key]) => key === section)?.[1]} value={result.total} unit="registos" icon="calendar" />
        <CardGrid>{result.items.map(c => <AppointmentCard key={(c.kind || 'Consultation') + ':' + c.id} consultation={c} typeLabel={c.kind === 'Guest' ? 'Pedido sem conta' : c.kind === 'Participation' ? 'Participação' : c.kind === 'Event' ? c.event?.kind === 'Retreat' ? 'Retiro' : 'Grupo' : 'Consulta individual'} clientName={manager && c.personId ? names.data?.[c.personId] || (names.loading ? 'A consultar o nome do cliente…' : 'Ficha de cliente') : null} stateLabel={c.process.processLabel} financialLabel={labels[c.financialState]} actionLabel={c.kind === 'Guest' ? 'Analisar pedido' : c.kind === 'Participation' ? 'Abrir participação' : c.kind === 'Event' ? 'Abrir atividade' : section === 'Payments' ? 'Abrir pagamento' : 'Abrir consulta'} onOpen={() => guard(() => openManagementRow(c))}><EventCardInfo event={c.event} /></AppointmentCard>)}</CardGrid>
        {result.total === 0 && <p>Não há consultas neste separador.</p>}<Pagination total={result.total} page={page} label="Páginas das consultas" onChange={setPage} />
      </>}</InformationCard>
    </>}
    {detail && !clientProfileId && <ConsultationDialog title={detail.serviceTitle} onClose={closeDetail} disabled={busy || uncertain}>
      <AppointmentSummary consultation={detail} showTitle={false} stateLabel={<ConsultationStatus as="span" consultation={detail} />} typeLabel="Consulta individual"
        clientName={manager && <button type="button" className={`text-button ${styles.clientLink}`} disabled={busy || uncertain || !detail.personId} onClick={() => guard(() => setClientProfileId(detail.personId))}>{names.data?.[detail.personId] || (names.loading ? 'A consultar o nome do cliente…' : 'Ficha de cliente')}</button>}
        location={<ConsultationLocation {...detail} manager={manager} />} />
      {feedback}
      {latestDetail.error && <p className="notice error" role="status">Não foi possível atualizar esta consulta. Os campos em edição foram mantidos.</p>}
      {latestDetail.data && latestDetail.data.version !== detail.version && <p className="notice" role="status">Esta consulta foi alterada. Os teus campos não foram substituídos. Fecha e volta a abrir para rever a informação antes de guardar.</p>}
      {manager && <WhatsAppMessage key={'whatsapp:' + detail.id} personId={detail.personId} startsAt={detail.startsAt}
        disabled={busy || uncertain || !!latestDetail.error || !!latestDetail.data && latestDetail.data.version !== detail.version} />}
      {(!followup || manager) && <><ConsultationValue consultation={detail} manager={manager} /><p>Crédito disponível: {money(detail.balance)}</p></>}
      {detail.advanceSatisfiedAt && <p>Condição de antecipação satisfeita.</p>}

      {manager && detail.paymentAlert && <div className="notice"><p>O cliente comunicou o pagamento. Confirma o recebimento quando o dinheiro chegar.</p></div>}
      {manager && !detail.actions?.includes('Settle') && detail.creditProposals?.some(p => !p.decision) && <div className="notice"><p>O cliente propõe utilizar {money(detail.creditProposals.find(p => !p.decision).amount)} de crédito.</p><button className="text-button" disabled={busy || uncertain} onClick={() => act('DeclineCreditProposal', { relatedId: detail.creditProposals.find(p => !p.decision).id })}>Não aplicar esta proposta</button></div>}
      {detail.actions?.includes('DeclarePayment') && <button className="secondary" disabled={busy || uncertain} onClick={() => act('DeclarePayment')}>Comunicar pagamento à terapeuta</button>}
      {detail.actions?.includes('MoveToOldDebts') && <button type="button" className="secondary" disabled={busy || uncertain} onClick={() => { if (window.confirm('Passar para Dívidas antigas? A dívida mantém-se e poderá ser paga mais tarde.')) void act('MoveToOldDebts') }}>Passar para dívidas antigas</button>}
      {manager && detail.collectionHistory?.length > 0 && <details><summary>Histórico da classificação da dívida</summary>{detail.collectionHistory.map(h => <p key={h.id}>{date(h.at)} · {h.closed ? 'Classificada como dívida antiga' : 'Classificação anterior alterada'} · {h.reason}</p>)}</details>}
      {manager && detail.paymentCommunications?.length > 0 && <details><summary>Comunicações de pagamento</summary>{detail.paymentCommunications.map(h => <p key={h.id}>{date(h.at)} · Comunicação recebida</p>)}</details>}
      {detail.state === 'Requested' && <>{manager && <form data-protect-draft onSubmit={e => submit(e, f => ({ action: 'Approve', id: detail.id, version: detail.version, choice: f.get('choice'), ...(f.has('allowClientCredit') && { allowClientCredit: true }) }))}><label>Método de pagamento para este cliente pagar a consulta<AdaptiveSelect aria-label="Método de pagamento para este cliente pagar a consulta" name="choice" disabled={!!detail.acceptedAt} value={approvalChoice || detail.paymentMode} onChange={event => setApprovalChoice(event.target.value)}>{[...new Set([detail.paymentMode, 'Postpayment', 'Gift'])].map(x => <option key={x} value={x}>{labels[x]}</option>)}</AdaptiveSelect></label>{(approvalChoice || detail.paymentMode) === 'Prepayment' && <CreditAuthorizationCard balance={detail.balance} amount={detail.referencePrice} disabled={busy || uncertain} />}<button disabled={busy || uncertain}>Aprovar marcação</button></form>}<button className="secondary" disabled={busy || uncertain} onClick={() => act('Reject')}>{manager ? 'Recusar marcação' : 'Desistir do pedido'}</button></>}
      {detail.state === 'Confirmed' && <>{!manager && detail.actions?.includes('Accept') && <ConsultationConditionsForm key={`${detail.id}:${detail.version}:${detail.termsVersion}`} consultation={detail} disabled={busy || uncertain} onAccept={values => act('Accept', values)} />}{!manager && <button className="secondary" disabled={busy || uncertain} onClick={() => { if (window.confirm('Confirmas o cancelamento? Não há penalização financeira.')) act('Cancel', { choice: 'Client' }) }}>Cancelar marcação</button>}</>}
      {manager && detail.actions?.includes('Keep') && <button disabled={busy || uncertain} onClick={() => act('Keep')}>Manter o intervalo bloqueado</button>}
      {manager && detail.keepBlocked && <button disabled={busy || uncertain} onClick={() => act('Release')}>Disponibilizar o intervalo cancelado</button>}
      {manager && detail.actions?.includes('Close') && <ConsultationResolution key={'resolution:' + detail.id} detail={detail} people={[{ id: detail.personId, data: { firstName: names.data?.[detail.personId] || 'Ficha de cliente', lastName: '' } }]} disabled={busy || uncertain} guard={guard} submit={submit} onClose={(command, onConfirmed) => send(command, false, onConfirmed)} act={act} instant={instant} />}
      {!detail.actions?.includes('Close') && detail.state !== 'Requested' && detail.financialState !== 'Paid' && detail.actions?.includes('Receipt') && <FinancialEntryForm key={'receipt:' + detail.id} people={[{ id: detail.personId, data: { firstName: names.data?.[detail.personId] || 'Ficha de cliente', lastName: '' } }]} consultation={detail} disabled={busy || uncertain} submit={submit} instant={instant} />}
      {manager && detail.state === 'Confirmed' && <ManagerCancellation key={'cancel:' + detail.id} detail={detail} disabled={busy || uncertain} submit={submit} />}
      {manager && !detail.actions?.includes('Close') && detail.actions?.includes('Settle') && <CreditSettlementForm key={detail.id} record={detail} manager disabled={busy || uncertain} act={act} />}
      <ConsultationPaymentHistory entries={detail.paymentHistory} />
      {detail.state === 'Performed' && (manager || followup) && <>{detail.photoIds?.map((id, index) => <img key={id} src={`/api/consultations/${detail.id}/photos/${id}`} alt={`Fotografia partilhada ${index + 1}`} style={{ maxWidth: '100%', height: 'auto' }} />)}<h3>Informação partilhada</h3><ClosureAttachmentList consultationId={detail.id} scope="shared" items={detail.sharedClosureMedia} /><div className="shared-consultation-note">{detail.sharedNote || (detail.sharedClosureMedia?.length ? null : 'Sem notas partilhadas.')}</div>{!manager && detail.section === 'Closed' && !detail.archivedAt && <button disabled={busy || uncertain} onClick={() => act('Archive', { publicContentVersion: detail.publicContentVersion })}>Vi as informações do acompanhamento - quero arquivar</button>}</>}
      {manager && (detail.privateNote || detail.privateClosureMedia?.length > 0) && <><h3>Nota privada — apenas gestão</h3><ClosureAttachmentList consultationId={detail.id} scope="private" items={detail.privateClosureMedia} />{detail.privateNote && <p className="shared-consultation-note">{detail.privateNote}</p>}</>}
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
