import { useEffect, useRef, useState } from 'react'
import Clients from './Clients'
import PersonalProfile from './PersonalProfile'
import AppLayout from './AppLayout'
import AppNavigation from './AppNavigation'
import AccountPage from './AccountPage'
import AgendaPage from './AgendaPage'
import ConsultationHistoryPage from './ConsultationHistoryPage'
import FinancePage from './FinancePage'
import ConsultationAlerts from './ConsultationAlerts'
import ClientConsultationHistory from './ClientConsultationHistory'
import TestimonialManager from './TestimonialManager'
import { apiRequest } from './identityApi'
import { isManager } from './identityRoles'
import { observeResource } from './liveUpdates'
import PrivateDraftProvider, { PrivateDraftStatus } from './PrivateDraftProvider'
import LiveResourceProvider from './LiveResourceProvider'
import { flushPrivateDrafts } from './privateDraftContext'
import styles from './Workspace.module.css'

export default function Workspace(props) {
  return <PrivateDraftProvider key={props.profile.id} owner={props.profile.id}><LiveResourceProvider><WorkspaceContent {...props} /></LiveResourceProvider></PrivateDraftProvider>
}

function WorkspaceContent({ profile, busy, perform, notify, error, message, errorRef, onSignOut, onForgetBrowser, onPasskeyUpdated, onAccountClosed, onSecuritySignedOut, onPublicTestimonials }) {
  const client = profile.role === 'Client'
  const operational = isManager(profile.role)
  const [page, setPage] = useState('Agenda')
  const [consultationEntry, setConsultationEntry] = useState(null)
  const [testimonialEntry, setTestimonialEntry] = useState(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [reviewSummary, setReviewSummary] = useState({ count: null, error: '' })
  const [reviewRevision, setReviewRevision] = useState(0)
  const [clientEntry, setClientEntry] = useState({ version: 0, view: 'Directory' })
  const [draftError, setDraftError] = useState('')
  const dirty = useRef(new Set())
  function hasDraft() { for (const form of dirty.current) if (!form.isConnected) dirty.current.delete(form); return dirty.current.size > 0 }
  useEffect(() => {
    function leaving(event) { if ([...dirty.current].some(form => form.isConnected) || document.querySelector('[data-pending-command="true"]')) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', leaving)
    function connection() { setOnline(navigator.onLine) }
    window.addEventListener('online', connection); window.addEventListener('offline', connection)
    return () => { window.removeEventListener('beforeunload', leaving); window.removeEventListener('online', connection); window.removeEventListener('offline', connection) }
  }, [])
  useEffect(() => {
    if (client || !online) return
    let current = true
    async function load() {
      try {
        const result = await apiRequest('clients/reviews/summary')
        if (current) setReviewSummary({ count: result.pendingReviewCount, error: '' })
      } catch {
        if (current) setReviewSummary(previous => ({ ...previous, error: 'Não foi possível atualizar as ocorrências de clientes.' }))
      }
    }
    const stop = observeResource('clientReviews', load)
    return () => { current = false; stop() }
  }, [client, online, reviewRevision])
  useEffect(() => {
    async function openPayments(event) {
      if (event.data?.type !== 'PACT_OPEN_PAYMENTS' || !client) return
      if ([...dirty.current].some(form => form.isConnected) && !window.confirm('Tens alterações por guardar. Queres ver os pagamentos e descartá-las?')) return
      try { await flushPrivateDrafts(); dirty.current.clear(); setConsultationEntry({ payments: true, revision: Date.now() }); setPage('Agenda') }
      catch (failure) { setDraftError(failure.message) }
    }
    navigator.serviceWorker?.addEventListener('message', openPayments)
    return () => navigator.serviceWorker?.removeEventListener('message', openPayments)
  }, [client])
  function confirmLeaving() {
    if (document.querySelector('[data-pending-command="true"]')) { setDraftError('Aguarda a confirmação da operação antes de sair desta área.'); return false }
    return !hasDraft() || window.confirm('Tens alterações por guardar. Queres sair desta área e descartá-las?')
  }
  async function guard(action) { if (confirmLeaving()) { try { await flushPrivateDrafts(); setDraftError(''); await action() } catch (failure) { setDraftError(failure.message) } } }
  function signOut() { guard(onSignOut) }
  function navigate(next) { if (next !== page) guard(() => { setConsultationEntry(null); setPage(next) }) }
  function openReviews() { guard(() => { setClientEntry(previous => ({ version: previous.version + 1, view: 'Reviews' })); setPage('Clients') }) }
  const ActiveConsultationPage = page === 'Finance' ? FinancePage : page === 'Consultations' ? ConsultationHistoryPage : AgendaPage
  const navigationItems = [
    ...((client || operational) ? [{ id: 'Agenda', label: 'Agenda', icon: 'calendar', active: page === 'Agenda' }] : []),
    ...(operational ? [{ id: 'Consultations', label: 'Consultas', icon: 'clock', active: page === 'Consultations' }, { id: 'Finance', label: 'Financeiro', icon: 'wallet', active: page === 'Finance' }] : []),
    ...(client ? [{ id: 'Followup', label: 'Consultas fechadas', icon: 'clock', active: page === 'Followup' }] : []),
    ...(!client ? [{ id: 'Clients', label: 'Clientes', icon: 'people', active: page === 'Clients' }] : []),
    ...(operational ? [{ id: 'Testimonials', label: 'Testemunhos', icon: 'heart', active: page === 'Testimonials' }] : []),
    { id: client ? 'Profile' : 'Account', label: 'Meu perfil', icon: 'user', active: ['Profile', 'Account'].includes(page) },
  ]
  return <AppLayout authenticated onResetCapture={event => dirty.current.delete(event.target)} onChangeCapture={event => { const form = event.target.closest('form[data-protect-draft]'); if (form) dirty.current.add(form) }}
    navigation={<AppNavigation items={navigationItems} onNavigate={navigate} />} session={<><span className="header-label">{client ? 'Cliente' : profile.role === 'TechnicalManager' ? 'Gestor técnico' : 'Gestora-terapeuta'}</span><button className="secondary" disabled={busy} onClick={signOut}>Terminar sessão</button></>} alerts={<>
      <PrivateDraftStatus />
      {!online && <p className="notice" role="status">Sem rede. Podes continuar um rascunho já desbloqueado; o fecho e as outras operações continuam a exigir ligação.</p>}
      {draftError && <p className="notice error" role="alert">{draftError}</p>}
      {(client || operational) && <ConsultationAlerts
        client={client}
        onFollowup={id => guard(() => { setConsultationEntry({ id, revision: Date.now() }); setPage(client ? 'Followup' : 'Agenda') })}
        onEvent={id => guard(() => { setConsultationEntry({ events: true, id, revision: Date.now() }); setPage('Agenda') })}
        onPack={id => guard(() => { setConsultationEntry({ packs: true, id, revision: Date.now() }); setPage('Agenda') })}
        onGuests={() => guard(() => { setConsultationEntry({ guests: true, revision: Date.now() }); setPage('Agenda') })}
        onFinance={() => guard(() => { setConsultationEntry(client ? { payments: true, revision: Date.now() } : null); setPage(operational ? 'Finance' : 'Agenda') })}
        onOpen={id => guard(() => { setConsultationEntry({ id, revision: Date.now() }); setPage('Agenda') })} />}
      {!client && reviewSummary.count > 0 && <div className="notice error review-alert" role="status"><p>{reviewSummary.error ? 'Última informação disponível: ' : ''}{reviewSummary.count === 1 ? 'Existe 1 ocorrência de cliente por analisar.' : `Existem ${reviewSummary.count} ocorrências de clientes por analisar.`}</p><button className="text-button" disabled={busy} onClick={openReviews}>Rever ocorrências de clientes</button></div>}
      {!client && reviewSummary.error && <div className="notice error" role="alert">{reviewSummary.error}<button className="text-button" disabled={busy} onClick={() => setReviewRevision(value => value + 1)}>Voltar a verificar</button></div>}
      {error && <div className="notice error" role="alert" ref={errorRef} tabIndex="-1">{error}</div>}{message && <div className="notice success" role="status">{message}</div>}</>}>
      {['Profile', 'Account'].includes(page) && <section className={styles.profile} aria-labelledby="my-profile-title"><h1 id="my-profile-title">Meu perfil</h1><nav className={styles.sections} aria-label="Secções do meu perfil">
        {client && <button className={page === 'Profile' ? '' : 'secondary'} aria-current={page === 'Profile' ? 'page' : undefined} onClick={() => navigate('Profile')}>Meus dados</button>}
        <button className={page === 'Account' ? '' : 'secondary'} aria-current={page === 'Account' ? 'page' : undefined} onClick={() => navigate('Account')}>A minha conta</button>
      </nav></section>}
      {!client && page === 'Clients' && <Clients key={clientEntry.version} initialView={clientEntry.view} pendingReviewCount={reviewSummary.count} busy={busy} perform={perform} notify={notify} guard={guard} />}
      {client && page === 'Profile' && <PersonalProfile busy={busy} perform={perform} notify={notify} />}
      {(client || operational) && ['Agenda', 'Consultations', 'Finance'].includes(page) && <ActiveConsultationPage key={`${page}:${consultationEntry?.payments ? 'payments' : consultationEntry?.events ? 'events' : consultationEntry?.packs ? 'packs' : consultationEntry?.guests ? 'guests' : 'default'}`} manager={operational} initialEntry={consultationEntry} guard={guard} onFollowup={id => guard(() => { setConsultationEntry({ id, revision: Date.now() }); setPage('Followup') })} onCreateClient={() => { setClientEntry(previous => ({ version: previous.version + 1, view: 'Create' })); setPage('Clients') }} />}
      {client && page === 'Followup' && <ClientConsultationHistory initialEntry={consultationEntry} guard={guard} />}
      {operational && page === 'Testimonials' && <TestimonialManager key={testimonialEntry?.revision || 'testimonials'} guard={guard} initialEntry={testimonialEntry} onPublic={onPublicTestimonials} />}
      {page === 'Account' && <AccountPage profile={profile} busy={busy} perform={perform} notify={notify} guard={guard} onPasskeyUpdated={onPasskeyUpdated} onSecuritySignedOut={onSecuritySignedOut} onAccountClosed={onAccountClosed} onForgetBrowser={onForgetBrowser} onRecover={item => guard(() => { if (item.kind === 'Testimonial' && operational) { setTestimonialEntry({ id: item.resourceId, revision: Date.now() }); setPage('Testimonials'); return } const events = item.kind === 'EventAttendance' || item.scope.startsWith('event-attendance:'); const bookingDraft = item.kind === 'ClientBooking' || item.scope.startsWith('client-booking:'); const conversation = item.kind === 'ConsultationMessage' || item.scope.startsWith('consultation-message:'); setConsultationEntry({ id: item.resourceId, recoverScope: item.scope, events, bookingDraft, revision: Date.now() }); setPage(events || bookingDraft ? 'Agenda' : conversation && client ? 'Followup' : 'Consultations') })} />}
  </AppLayout>
}
