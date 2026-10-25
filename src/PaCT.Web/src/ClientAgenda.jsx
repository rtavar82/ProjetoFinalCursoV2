import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import { usePrivateVault } from './privateDraftContext'
import ClientCalendar from './ClientCalendar'
import ClientBookingDialog from './ClientBookingDialog'
import ConsultationDialog from './ConsultationDialog'
import GroupEventsPanel from './GroupEventsPanel'
import SessionPacksPanel from './SessionPacksPanel'
import ClientFinance from './ClientFinance'
import InformationCard from './InformationCard'
import { agendaDate, agendaMoney, agendaClock } from './agendaTime'
import styles from './ClientAgenda.module.css'

const tabs = [['Payments', 'Pagamentos pendentes'], ['Upcoming', 'Próximas consultas'], ['Other', 'Consultas pendentes e canceladas'], ['Closed', 'Consultas fechadas']]
const explanations = {
  Payments: 'Consultas com pagamentos ou valores que aguardam validação, independentemente da data ou do estado da consulta.',
  Upcoming: 'Consultas confirmadas, com início futuro e sem pagamento pendente de validação.',
  Other: 'Consultas por confirmar, por tratar ou canceladas, sem pagamento pendente de validação.',
  Closed: 'Consultas realizadas ou com falta registada, fechadas e sem pendência financeira.',
}
const states = { Requested: 'A aguardar confirmação', Confirmed: 'Confirmada', AwaitingClosure: 'Por fechar', Performed: 'Consulta fechada', NoShow: 'Não compareceu', CancelledClient: 'Cancelada por ti', CancelledManager: 'Cancelada pela terapeuta', Expired: 'Pedido expirado', Rejected: 'Pedido recusado' }
function badge(c) { return c.section === 'Payments' ? c.financialState === 'ConditionsPending' ? 'Por validar condições' : 'Pagamento pendente' : c.state === 'Performed' ? c.financialState === 'Paid' ? 'Fechada — paga' : 'Fechada — sem dívida' : states[c.state] || c.state }

export default function ClientAgenda({ initialEntry, guard, onFollowup }) {
  const [view, setView] = useState(initialEntry?.browse ? 'Calendar' : initialEntry?.events ? 'Events' : initialEntry?.packs ? 'Packs' : 'List')
  const [sectionChoice, setSectionChoice] = useState(() => ({ section: 'Payments', automatic: !initialEntry?.payments }))
  const section = sectionChoice.section
  const [page, setPage] = useState(1), [seen, setSeen] = useState(false)
  const [request, setRequest] = useState(initialEntry?.bookingDraft ? { id: initialEntry.id, scope: initialEntry.recoverScope } : null)
  const [detail, setDetail] = useState(null), [domain, setDomain] = useState(initialEntry?.id || null)
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false)
  const [extrasOpen, setExtrasOpen] = useState(false), [browseService, setBrowseService] = useState(initialEntry?.serviceId || '')
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  const pending = useRef(null), activeWrite = useRef(false)
  const vault = usePrivateVault()
  const read = useCallback(signal => apiRequest(`consultations?section=${section}&page=${page}${section === 'Closed' ? '&seen=' + seen : ''}`, undefined, { signal }), [section, page, seen])
  const list = useLiveResource('consultations', `client-agenda:${section}:${page}:${seen}`, read, view === 'List')
  const detailId = detail?.id
  const readDetail = useCallback(signal => apiRequest('consultations/' + detailId, undefined, { signal }), [detailId])
  const latest = useLiveResource('consultations', 'detail:' + detailId, readDetail, !!detailId)
  useEffect(() => {
    if (!initialEntry?.id || initialEntry.events || initialEntry.packs || initialEntry.bookingDraft) return
    let current = true
    apiRequest('consultations/' + initialEntry.id).then(value => { if (current) setDetail(value) }).catch(failure => { if (current) setError(failure.message) })
    return () => { current = false }
  }, [initialEntry])
  async function send(command) {
    if (activeWrite.current) throw new Error('Aguarda a confirmação da operação.')
    if (!navigator.onLine) throw new Error('Sem ligação. Volta a tentar quando tiveres rede.')
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
      const command = retry ? pending.current : { action, id: detail.id, version: detail.version, ...extra }
      if (!command) return
      await send(command)
      if (detail) { try { setDetail(await apiRequest('consultations/' + detail.id)) } catch { setError('A operação foi confirmada. Não foi possível atualizar os detalhes.'); latest.refresh() } }
    } catch { /* Keep the confirmed snapshot and pending operation available. */ }
  }
  async function open(id) { try { setDetail(await apiRequest('consultations/' + id)); setError('') } catch (failure) { setError(failure.message) } }
  function domainOpen(kind, id) { guard(() => { setDomain(id); setView(kind === 'Pack' ? 'Packs' : 'Events') }) }
  async function startRequest(seed) {
    await guard(async () => {
      if (!vault?.vault) { setError('Não foi possível preparar o rascunho. Tenta desbloquear os rascunhos em A minha conta.'); return }
      const id = crypto.randomUUID(), scope = 'client-booking:' + id
      try {
        await vault.vault.save(scope, { kind: 'ClientBooking', resourceId: id, title: 'Pedido de marcação', baseVersion: 1,
          fields: { startsAt: seed.startsAt, selected: seed.choices[0], review: null, pending: null } }, [], 0)
        setRequest({ id, scope, ...seed }); setError('')
      } catch (failure) { setError(failure.message) }
    })
  }
  const feedback = <>{error && <p role="alert" className="notice error">{error}</p>}{message && <p role="status" className="notice success">{message}</p>}{uncertain && !request && <button disabled={busy} onClick={() => void act(null, {}, true)}>Verificar resultado</button>}</>
  const result = list.data
  // Resolve the default once, from the actual Payments list. Explicit navigation
  // and later refreshes must never replace a section the client has chosen.
  if (sectionChoice.automatic && view === 'List' && result && !list.error) {
    setSectionChoice({ section: result.total === 0 ? 'Upcoming' : 'Payments', automatic: false })
  }
  function changeSection(value) { guard(() => { setSectionChoice({ section: value, automatic: false }); setPage(1); setSeen(false) }) }
  return <section className={styles.page} data-pending-command={busy || uncertain ? 'true' : undefined}>
    <p className={styles.eyebrow}>A tua agenda</p><h1>Um tempo para ti.</h1><p>Escolhe o dia. Encontra o teu horário.</p>
    {!detail && !request && !['Packs', 'Events'].includes(view) && feedback}
    <nav className={styles.primaryTabs} aria-label="Agenda"><button className={view === 'Calendar' ? styles.selected : 'secondary'} aria-pressed={view === 'Calendar'} onClick={() => guard(() => setView('Calendar'))}>Agendar</button><button className={view === 'List' ? styles.selected : 'secondary'} aria-pressed={view === 'List'} onClick={() => guard(() => setView('List'))}>As minhas marcações</button></nav>
    <div hidden={view !== 'Calendar'}><ClientCalendar key={browseService} initialServiceId={browseService} enabled={view === 'Calendar'} onChoose={startRequest} onEvent={id => domainOpen('Event', id)} /></div>
    {view === 'List' && <><nav className={styles.tabs} aria-label="Separadores de consultas">{tabs.map(([id, label]) => <button key={id} className={section === id ? styles.selected : 'secondary'} aria-pressed={section === id} onClick={() => changeSection(id)}>{label}</button>)}</nav>
      <p className={styles.muted}>{explanations[section]}</p>
      {section === 'Closed' && <nav className={styles.tabs} aria-label="Leitura das consultas"><button className={!seen ? '' : 'secondary'} onClick={() => guard(() => { setSeen(false); setPage(1) })}>Por ver{result ? ` (${result.totalUnseen})` : ''}</button><button className={seen ? '' : 'secondary'} onClick={() => guard(() => { setSeen(true); setPage(1) })}>Histórico{result ? ` (${result.totalSeen})` : ''}</button></nav>}
      {result && <div className={styles.balances}><p>Saldo disponível na conta: <strong>{result.balance == null ? '—' : agendaMoney(result.balance)}</strong></p><p className={styles.debt}>Valor em dívida: <strong>{result.totalDebt == null ? '—' : agendaMoney(result.totalDebt)}</strong>{result.undefinedDebt ? ' · Acrescem valores por definir.' : ''}</p></div>}
      <InformationCard cardId="client-appointments" loading={list.loading} error={list.error} onRetry={list.refresh}>
        <div className={styles.list}>{result?.items.map(c => <article className={styles.appointment} key={c.id}><span className={styles.badge}>{badge(c)}</span><h2>{c.serviceTitle}</h2><p>{states[c.state]}{c.state === 'Performed' && c.section === 'Payments' ? c.finalAmount == null ? ' · Valor por definir' : ' · Valor por pagar' : ''}</p><p>{agendaDate(c.startsAt)} — {agendaClock(c.endsAt)}</p><p>{c.modality === 'Remote' ? 'Consulta remota' : c.publicLocation}</p><button className="text-button" onClick={() => c.state === 'Performed' && c.section === 'Closed' ? onFollowup(c.id) : void open(c.id)}>{c.section === 'Payments' ? 'Ver pagamento' : c.state === 'Performed' ? 'Ver consulta e acompanhamento' : 'Ver detalhes'}</button></article>)}</div>
        {result?.total === 0 && <p className={styles.empty}>Não há marcações nesta lista.</p>}
        {result && result.total > 8 && <nav className="pager" aria-label="Páginas das marcações"><button disabled={page === 1} onClick={() => guard(() => setPage(n => n - 1))}>Anterior</button><span>Página {page}</span><button disabled={page * 8 >= result.total} onClick={() => guard(() => setPage(n => n + 1))}>Seguinte</button></nav>}
      </InformationCard>
    </>}
    <details onToggle={event => setExtrasOpen(event.currentTarget.open)}><summary>Outras opções da agenda</summary><nav className={styles.tabs} aria-label="Outras áreas da agenda"><button className="secondary" onClick={() => domainOpen('Pack', null)}>Packs</button><button className="secondary" onClick={() => domainOpen('Event', null)}>Grupos e retiros</button></nav>{extrasOpen && view === 'List' && section === 'Payments' && <ClientFinance onOpenDomain={domainOpen} />}</details>
    {view === 'Events' && <GroupEventsPanel manager={false} send={command => send(command).catch(() => null)} disabled={busy || uncertain} guard={guard} feedback={feedback} initialEntry={domain ? { events: true, id: domain } : null} />}
    {view === 'Packs' && <SessionPacksPanel manager={false} send={command => send(command).catch(() => null)} disabled={busy || uncertain} guard={guard} feedback={feedback} initialId={domain} />}
    {request && <ClientBookingDialog key={request.id} seed={request} onBrowseService={id => { setRequest(null); setBrowseService(id); setView('Calendar') }} send={send} disabled={busy} guard={guard} onClose={() => setRequest(null)} onConfirmed={() => { setRequest(null); setSectionChoice({ section: 'Other', automatic: false }); setPage(1); setView('List') }} />}
    {detail && <ClientDetail detail={detail} latest={latest} feedback={feedback} disabled={busy || uncertain} act={act} onClose={() => guard(() => setDetail(null))} onReview={after => guard(() => { setDetail(latest.data); after() })} onFollowup={() => onFollowup(detail.id)} />}
  </section>
}

function ClientDetail({ detail: c, latest, feedback, disabled, act, onClose, onReview, onFollowup }) {
  const [accepted, setAccepted] = useState(false), [error, setError] = useState('')
  const changed = latest.data && (latest.data.version !== c.version || latest.data.state !== c.state)
  return <ConsultationDialog compact label="Detalhe da consulta" disabled={disabled} onClose={onClose}><h2>{c.serviceTitle}</h2>{feedback}<p>{agendaDate(c.startsAt)} — {agendaClock(c.endsAt)}</p><p>{states[c.state]}</p><p>{c.modality === 'Remote' ? 'Consulta remota' : c.publicLocation}</p>
    {changed && <p className="notice" role="status">A consulta mudou. O preenchimento foi mantido.<button className="text-button" disabled={disabled} onClick={() => onReview(() => setAccepted(false))}>Rever consulta</button></p>}
    {latest.error && <p role="alert" className="notice error">{latest.error}</p>}
    <p>{c.state === 'Performed' ? c.finalAmount == null ? 'Valor final por definir' : `Valor final: ${agendaMoney(c.finalAmount)}` : c.paymentMode === 'Contribution' ? 'Contribuição livre, paga depois da consulta.' : `Valor previsto: ${agendaMoney(c.referencePrice)}`}</p><p>Crédito disponível: {agendaMoney(c.balance)}</p>
    {c.instructions && <p className={styles.savedText}>{c.instructions}</p>}
    {c.collectionClosed && <p className="notice">Para regularizar esta consulta, contacta diretamente a terapeuta.</p>}
    {c.actions?.includes('Accept') && <form data-protect-draft onSubmit={event => { event.preventDefault(); if (!accepted) { setError('Confirma que leste e aceitas as condições.'); return }; setError(''); void act('Accept', { conditionsAccepted: true, termsVersion: c.termsVersion }) }}><h3>Condições de pagamento</h3><p>{c.terms}</p>{error && <p role="alert" className="notice error">{error}</p>}<label className="checkbox"><input type="checkbox" checked={accepted} disabled={disabled || changed} onChange={event => setAccepted(event.target.checked)} />Li e aceito as condições.</label><button disabled={disabled || changed}>Aceito as condições. De seguida farei este pagamento.</button></form>}
    {c.actions?.includes('Reject') && <button className="secondary" disabled={disabled || changed} onClick={() => { if (window.confirm('Queres desistir deste pedido?')) void act('Reject') }}>Desistir do pedido</button>}
    {c.actions?.includes('Cancel') && <button className="secondary" disabled={disabled || changed} onClick={() => { if (window.confirm('Confirmas o cancelamento? Não há penalização financeira.')) void act('Cancel', { choice: 'Client' }) }}>Cancelar marcação</button>}
    {c.actions?.includes('DeclarePayment') && !c.expectationOpen && <button className="secondary" disabled={disabled || changed} onClick={() => void act('DeclarePayment')}>Comunicar pagamento à terapeuta</button>}
    {c.actions?.includes('Settle') && <button disabled={disabled || changed || c.balance < c.finalAmount} onClick={() => { if (window.confirm(`Pagar integralmente ${agendaMoney(c.finalAmount)} com crédito?`)) void act('Settle') }}>Pagar integralmente com crédito</button>}
    {c.state === 'Performed' && <button className="secondary" disabled={disabled} onClick={onFollowup}>Ver consulta e acompanhamento com a terapeuta</button>}
    {c.state === 'NoShow' && c.section === 'Closed' && !c.archivedAt && <button disabled={disabled || changed} onClick={() => void act('Archive', { publicContentVersion: c.publicContentVersion })}>Já vi a informação sobre a consulta, posso arquivar.</button>}
  </ConsultationDialog>
}
