import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import Clients from './Clients'
import PersonalProfile from './PersonalProfile'
import AppLayout from './AppLayout'
import AppNavigation from './AppNavigation'
import ActionButton from './ActionButton'
import Heading from './Heading'
import AccountPage from './AccountPage'
import AgendaPage from './AgendaPage'
import ConsultationHistoryPage from './ConsultationHistoryPage'
import FinancePage from './FinancePage'
import ConsultationAlerts from './ConsultationAlerts'
import TestimonialManager from './TestimonialManager'
import ManagementPage from './ManagementPage'
import ManagerTasksPage from './ManagerTasksPage'
import PublicPresentation from './PublicPresentation'
import PublicTestimonials from './PublicTestimonials'
import { clientHomeHashes, clientHomePage, isPublicOpeningAddress } from './publicPresentationData'
import SharingFeed from './SharingFeed'
import { apiRequest } from './identityApi'
import { isManager } from './identityRoles'
import { observeResource } from './liveUpdates'
import LiveResourceProvider from './LiveResourceProvider'
import useLiveResource from './useLiveResource'
import styles from './Workspace.module.css'
import { installAccountRequestScope } from './managerWriteRecovery'
import ManagerRecoveryProvider from './ManagerRecoveryProvider'
import useRecoveryState from './useRecoveryState'
import { useContext } from 'react'
import { ManagerRecoveryContext } from './managerRecoveryContext'

export default function Workspace(props) {
  useLayoutEffect(() => installAccountRequestScope(props.profile.id), [props.profile.id])
  return <ManagerRecoveryProvider key={props.profile.id} profile={props.profile}><LiveResourceProvider><WorkspaceContent {...props} /></LiveResourceProvider></ManagerRecoveryProvider>
}

function WorkspaceContent({ profile: initialProfile, busy, perform, notify, error, message, errorRef, onSignOut, onForgetBrowser, onPasskeyUpdated, onAccountClosed, onSecuritySignedOut, onPublicTestimonials, onOpenEntry }) {
  const readAccount = useCallback(() => apiRequest('identity/me'), [])
  const account = useLiveResource('accountSecurity', 'signed-in-account', readAccount)
  const profile = account.data || initialProfile
  const recovery = useContext(ManagerRecoveryContext)
  const client = profile.role === 'Client'
  const operational = isManager(profile.role)
  const [homePage, setHomePage] = useState(() => clientHomePage() || 'PublicHome')
  const [page, setPage] = useRecoveryState('view:workspace:page', () => {
    if (client && clientHomePage()) return 'Home'
    const hash = window.location.hash.split('?')[0]
    return operational && hash === '#calendario-google' ? 'Management' : operational && hash === '#tarefas' ? 'Tasks' : hash === '#partilhas' ? 'Sharing' : 'Agenda'
  })
  useEffect(() => {
    const hash = page === 'Sharing' ? '#partilhas' : page === 'Tasks' ? '#tarefas' : client && page === 'Home' ? clientHomeHashes[homePage] : ''
    if (hash && window.location.hash !== hash) window.history.replaceState({ workspace: true }, '', hash)
    else if (!hash && (client && clientHomePage() || ['#partilhas', '#tarefas'].includes(window.location.hash)
      || page !== 'Management' && window.location.hash.split('?')[0] === '#calendario-google')) {
      window.history.replaceState({ workspace: true }, '', client ? '#agenda' : '#inicio')
    }
  }, [client, homePage, page])
  const [consultationEntry, setConsultationEntry] = useRecoveryState('view:workspace:consultationEntry', () =>
    client && (window.history.state?.entry?.payments || new URLSearchParams(window.location.search).get('view') === 'payments') ? { payments: true } : null)
  const [online, setOnline] = useState(navigator.onLine)
  const [reviewSummary, setReviewSummary] = useState({ count: null, error: '' })
  const [reviewRevision, setReviewRevision] = useState(0)
  const [clientEntry, setClientEntry] = useRecoveryState('view:workspace:clientEntry', { version: 0, view: 'Directory' })
  const [packEntry, setPackEntry] = useRecoveryState('view:workspace:packEntry', null)
  const [draftError, setDraftError] = useState('')
  const dirty = useRef(new Set())
  function hasDraft(submittedForm) {
    for (const form of dirty.current) if (!form.isConnected) dirty.current.delete(form)
    return [...dirty.current].some(form => form !== submittedForm) || !!recovery?.hasContent()
  }
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
      const agenda = event.data?.type === 'PACT_OPEN_AGENDA'
      const tasks = operational && event.data?.type === 'PACT_OPEN_TASKS'
      if (!agenda && !tasks && (event.data?.type !== 'PACT_OPEN_PAYMENTS' || !client)) return
      if (document.querySelector('[data-pending-command="true"]')) { setDraftError('Aguarda a confirmação da operação antes de sair desta área.'); return }
      if ([...dirty.current].some(form => form.isConnected) && !window.confirm('Tens alterações por guardar. Queres abrir o aviso e descartá-las?')) return
      dirty.current.clear()
      setConsultationEntry(tasks ? null : { payments: client, revision: Date.now() })
      setPage(tasks ? 'Tasks' : 'Agenda')
    }
    navigator.serviceWorker?.addEventListener('message', openPayments)
    return () => navigator.serviceWorker?.removeEventListener('message', openPayments)
  }, [client, operational, setConsultationEntry, setPage])
  function confirmLeaving(submittedForm) {
    if (document.querySelector('[data-pending-command="true"]')) { setDraftError('Aguarda a confirmação da operação antes de sair desta área.'); return false }
    if (!hasDraft(submittedForm)) return true
    if (!window.confirm('Tens alterações por guardar. Queres sair desta área e descartá-las?')) return false
    recovery?.clearContent(); return true
  }
  async function guard(action, submittedForm) { if (confirmLeaving(submittedForm)) { try { setDraftError(''); await action() } catch (failure) { setDraftError(failure.message) } } }
  function signOut() { guard(onSignOut) }
  function navigate(next) { if (next !== page || next === 'Home') guard(() => { setConsultationEntry(null); setPackEntry(null); if (next === 'Home') { setHomePage('PublicHome'); window.scrollTo(0, 0) } setPage(next) }) }
  function openPack(id) { guard(() => {
    if (client) { setPackEntry({ id, revision: Date.now() }); setPage('Account') }
    else { setConsultationEntry({ packs: true, id, revision: Date.now() }); setPage('Finance') }
  }) }
  function navigateHome(next, serviceId = '') {
    guard(() => {
      if (next === 'PublicAgenda') { setConsultationEntry({ browse: true, serviceId }); setPage('Agenda') }
      else { setHomePage(next); setPage('Home') }
      window.scrollTo(0, 0)
    })
  }
  const openWorkspaceLink = useEffectEvent(event => {
    const opening = isPublicOpeningAddress()
    const next = client && clientHomePage()
    if (!opening && (!next || page === 'Home' && homePage === next)) return
    if (!confirmLeaving()) {
      window.history.replaceState(window.history.state, '', event.oldURL)
      return
    }
    if (opening) { onOpenEntry(); return }
    setDraftError('')
    setConsultationEntry(null)
    setPackEntry(null)
    setHomePage(next)
    setPage('Home')
    window.scrollTo(0, 0)
  })
  useEffect(() => {
    const open = event => openWorkspaceLink(event)
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [])

  function openReviews() { guard(() => { setClientEntry(previous => ({ version: previous.version + 1, view: 'Reviews' })); setPage('Clients') }) }
  const ActiveConsultationPage = page === 'Finance' ? FinancePage : page === 'Consultations' ? ConsultationHistoryPage : AgendaPage
  const navigationItems = [
    ...(client ? [{ id: 'Home', label: 'Início', icon: 'home', active: page === 'Home' }] : []),
    ...((client || operational) ? [{ id: 'Agenda', label: 'Agenda', icon: 'calendar', active: page === 'Agenda' }] : []),
    ...(operational ? [{ id: 'Consultations', label: 'Consultas', icon: 'clock', active: page === 'Consultations' }, { id: 'Finance', label: 'Financeiro', icon: 'bank', active: page === 'Finance' }] : []),
    ...((client || operational) ? [{ id: 'Sharing', label: 'Partilhas', icon: 'conversations', active: page === 'Sharing' }] : []),
    ...(!client ? [{ id: 'Clients', label: 'Clientes', icon: 'people', active: page === 'Clients' }] : []),
    ...(operational ? [{ id: 'Testimonials', label: 'Testemunhos', icon: 'heart', active: page === 'Testimonials' }] : []),
    ...(operational ? [{ id: 'Tasks', label: 'Tarefas', icon: 'tasks', active: page === 'Tasks' }] : []),
    ...(operational ? [{ id: 'Management', label: 'Gestão da aplicação', icon: 'settings', active: page === 'Management' }] : []),
    { id: client ? 'Profile' : 'Account', label: 'Meu perfil', icon: 'user', active: ['Profile', 'Account'].includes(page) },
  ]
  const roleLabel = client ? 'Cliente' : profile.role === 'TechnicalManager' ? 'Gestor técnico' : 'Gestora-terapeuta'
  const sessionName = (client ? profile.clientName?.trim() : null) || profile.displayName?.trim() || roleLabel
  const clientHome = client && page === 'Home'
  const themedLayout = client && ['Home', 'Agenda', 'Sharing', 'Profile', 'Account'].includes(page) || operational && ['Agenda', 'Consultations', 'Finance', 'Account', 'Clients'].includes(page)
  return <AppLayout page={clientHome ? homePage : page} authenticated
    themedLayout={themedLayout} onHome={client ? () => navigate('Home') : undefined} onResetCapture={event => dirty.current.delete(event.target)} onChangeCapture={event => { const form = event.target.closest('form[data-protect-draft]'); if (form) dirty.current.add(form) }}
    navigation={<AppNavigation items={navigationItems} onNavigate={navigate} />}
    sessionName={sessionName} sessionRole={client ? undefined : roleLabel}
    session={<ActionButton variant="secondary" disabled={busy} onClick={signOut}>Terminar sessão</ActionButton>} alerts={<>
      {!online && <p className="notice" role="status">Sem rede. O preenchimento continua neste formulário enquanto estiver aberto; os envios exigem ligação.</p>}
      {draftError && <p className="notice error" role="alert">{draftError}</p>}
      {(client || operational) && <ConsultationAlerts
        client={client}
        onFollowup={id => guard(() => { setConsultationEntry({ id, followup: client, conversation: client, revision: Date.now() }); setPage('Agenda') })}
        onEvent={(id, participationId) => guard(() => { setConsultationEntry({ events: true, id, participationId, revision: Date.now() }); setPage('Agenda') })}
        onPack={openPack}
        onTasks={() => navigate('Tasks')}
        onGuests={id => guard(() => { setConsultationEntry({ guests: true, id, revision: Date.now() }); setPage('Agenda') })}
        onFinance={() => guard(() => { setConsultationEntry(client ? { payments: true, revision: Date.now() } : null); setPage(operational ? 'Finance' : 'Agenda') })}
        onOpen={id => guard(() => { setConsultationEntry({ id, revision: Date.now() }); setPage('Agenda') })} />}
      {!client && reviewSummary.count > 0 && <div className="notice error review-alert" role="status"><p>{reviewSummary.error ? 'Última informação disponível: ' : ''}{reviewSummary.count === 1 ? 'Existe 1 ocorrência de cliente por analisar.' : `Existem ${reviewSummary.count} ocorrências de clientes por analisar.`}</p><button className="text-button" disabled={busy} onClick={openReviews}>Rever ocorrências de clientes</button></div>}
      {!client && reviewSummary.error && <div className="notice error" role="alert">{reviewSummary.error}<button className="text-button" disabled={busy} onClick={() => setReviewRevision(value => value + 1)}>Voltar a verificar</button></div>}
      {error && <div className="notice error" role="alert" ref={errorRef} tabIndex="-1">{error}</div>}{message && <div className="notice success" role="status">{message}</div>}</>}>
      {client && ['Profile', 'Account'].includes(page) && <section className={styles.profile} aria-labelledby="my-profile-title"><Heading level={1} id="my-profile-title">Meu perfil</Heading>
        {<nav className={styles.sections} aria-label="Secções do meu perfil">
          <ActionButton variant={page === 'Profile' ? 'primary' : 'secondary'} aria-current={page === 'Profile' ? 'page' : undefined} onClick={() => navigate('Profile')}>Meus dados</ActionButton>
          <ActionButton variant={page === 'Account' ? 'primary' : 'secondary'} aria-current={page === 'Account' ? 'page' : undefined} onClick={() => navigate('Account')}>A minha conta</ActionButton>
        </nav>}
      </section>}
      {clientHome && <PublicPresentation key={homePage} embedded page={homePage} profile={profile} onNavigate={navigateHome}>
        {homePage === 'PublicTestimonials' && <PublicTestimonials onBack={() => navigateHome('PublicHome')} />}
      </PublicPresentation>}
      {!client && page === 'Clients' && <Clients key={clientEntry.version} initialView={clientEntry.view} pendingReviewCount={reviewSummary.count} busy={busy} perform={perform} notify={notify} guard={guard} />}
      {client && page === 'Profile' && <PersonalProfile busy={busy} perform={perform} notify={notify} />}
      {(client || operational) && ['Agenda', 'Consultations', 'Finance'].includes(page) && <ActiveConsultationPage key={`${page}:${operational ? 'manager' : consultationEntry?.payments ? 'payments' : consultationEntry?.events ? 'events' : consultationEntry?.packs ? 'packs' : consultationEntry?.guests ? 'guests' : 'default'}`} manager={operational} initialEntry={consultationEntry} guard={guard} perform={perform} notify={notify} profileBusy={busy} onCreateClient={() => { setClientEntry(previous => ({ version: previous.version + 1, view: 'Create' })); setPage('Clients') }} />}
      {(client || operational) && page === 'Sharing' && <SharingFeed profile={profile} guard={guard} />}
      {operational && page === 'Testimonials' && <TestimonialManager guard={guard} onPublic={onPublicTestimonials} />}
      {operational && page === 'Tasks' && <ManagerTasksPage guard={guard} />}
      {operational && page === 'Management' && <ManagementPage role={profile.role} guard={guard} busy={busy} />}
      {page === 'Account' && <AccountPage profile={profile} busy={busy} perform={perform} notify={notify} guard={guard} onPasskeyUpdated={onPasskeyUpdated} onSecuritySignedOut={onSecuritySignedOut} onAccountClosed={onAccountClosed} onForgetBrowser={onForgetBrowser} packEntry={packEntry} />}
  </AppLayout>
}
