import { useEffect, useRef, useState } from 'react'
import { request } from './identityApi'
import RegistrationFields from './RegistrationFields'
import ClientProfileForm from './ClientProfileForm'
import { validatePasswordFields } from './registrationValidation'
import Workspace from './Workspace'
import InvitedTherapistRegistration from './InvitedTherapistRegistration'
import './App.css'
import AppLayout from './AppLayout'
import AuthPage from './AuthPage'
import PasswordField from './PasswordField'
import { GoogleSignInButton } from './AccountSecuritySettings'
import { enrollPasskey, verifyPasskey } from './passkeys'
import VisitorAgenda from './VisitorAgenda'
import PublicPresentation from './PublicPresentation'
import PublicTestimonials from './PublicTestimonials'
import PublicPromotions from './PublicPromotions'
import { publicRoute } from './publicPresentationData'
import { cancelSubmittedWrites } from './submittedWrites'

function readLink() {
  const parameters = new URLSearchParams(window.location.hash.slice(1))
  const link = { confirmationToken: parameters.get('confirm-email'), invitationToken: parameters.get('therapist-invitation'), accessEmailToken: parameters.get('confirm-access-email'), passwordChangeToken: parameters.get('change-password'), googleResult: parameters.get('google-result') }
  return link
}

function linkStage(link) {
  if (Object.values(link).filter(Boolean).length > 1) return 'InvalidLink'
  return link.googleResult ? 'GoogleReturn' : link.passwordChangeToken ? 'PasswordChangeLink' : link.accessEmailToken ? 'AccessEmailLink' : link.invitationToken ? 'Invitation' : link.confirmationToken ? 'EmailLink' : null
}

export default function App() {
  const [{ confirmationToken, invitationToken, accessEmailToken, passwordChangeToken, googleResult }, setLink] = useState(readLink)
  const [stage, setStage] = useState(!navigator.onLine ? 'Offline' : window.location.protocol !== 'https:' ? 'Insecure' : linkStage({ confirmationToken, invitationToken, accessEmailToken, passwordChangeToken, googleResult }) || 'Loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [profile, setProfile] = useState(null)
  useEffect(() => { cancelSubmittedWrites() }, [profile?.id])
  const [guestSelection, setGuestSelection] = useState(null)
  const [publicService, setPublicService] = useState(() => publicRoute().serviceId)
  const [recoveryCodes, setRecoveryCodes] = useState([])
  const errorRef = useRef(null)
  const busyRef = useRef(false)
  function choosePublicBooking(selection) {
    if (profile) { window.history.pushState(null, '', '#inicio'); setStage('SignedIn') }
    else setGuestSelection(selection)
  }

  useEffect(() => {
    function openLink() {
      const next = readLink()
      if (!Object.values(next).some(Boolean)) {
        if (['PublicHome', 'PublicTherapist', 'PublicTestimonials', 'PublicPromotions', 'PublicAgenda', 'SignIn'].includes(stage) || profile && ['#testemunhos', '#partilhas'].includes(window.location.hash)) {
          const route = publicRoute()
          if (route.stage === stage && route.serviceId === publicService) return
          if (document.querySelector('[data-pending-command="true"]')) { window.history.forward(); return }
          if ((guestSelection || document.querySelector('[data-guest-request="true"]')) && !window.confirm('Queres sair e descartar o preenchimento do pedido?')) { window.history.forward(); return }
          setPublicService(route.serviceId); setGuestSelection(null); setStage(route.stage); setError(''); setMessage('')
        }
        return
      }
      window.history.replaceState(null, '', window.location.pathname)
      setLink(next); setError(''); setMessage('')
      setStage(linkStage(next))
    }
    window.addEventListener('hashchange', openLink)
    return () => window.removeEventListener('hashchange', openLink)
  }, [profile, stage, guestSelection, publicService])

  useEffect(() => {
    if (confirmationToken || invitationToken || accessEmailToken || passwordChangeToken || googleResult) { window.history.replaceState(null, '', window.location.pathname); return }
    if (!navigator.onLine) return
    if (window.location.protocol !== 'https:') return
    let current = true
    async function initialize() {
      try {
        const state = await request('installation')
        let next = state.prepared ? (state.managerExists ? 'SignIn' : 'Register') : 'NotPrepared'
        if (state.managerExists) {
          try { const me = await request('me'); if (current) setProfile(me); next = window.location.hash === '#testemunhos' ? 'PublicTestimonials' : window.location.hash === '#partilhas' ? 'PublicPromotions' : 'SignedIn' }
          catch (failure) {
            if (failure.status !== 401) throw failure
            next = (await request('progress')).stage
            if (next === 'SignIn') next = publicRoute().stage
          }
        }
        if (current) setStage(next)
      } catch (failure) { if (current) { setError(failure.message); setStage('Unavailable') } }
    }
    initialize()
    return () => { current = false }
  }, [confirmationToken, invitationToken, accessEmailToken, passwordChangeToken, googleResult])

  useEffect(() => {
    if (!googleResult || confirmationToken || invitationToken || accessEmailToken || passwordChangeToken) return
    let current = true
    async function resumeGoogle() {
      const messages = { Failed: 'Não foi possível concluir a entrada com Google. Tenta novamente.', NotLinked: 'Esta conta Google ainda não está associada. Entra com o teu email e palavra-passe e associa-a em Meu perfil → A minha conta.', PasswordRequired: 'Entra com o teu email e a nova palavra-passe antes de voltares a usar o Google.', Conflict: 'A conta Google já está associada. Não foi alterada nenhuma conta.' }
      if (!['Continue', 'Linked'].includes(googleResult)) {
        await Promise.resolve()
        if (current) { setProfile(null); setError(messages[googleResult] || messages.Failed); setStage('SignIn') }
        return
      }
      try {
        try { const me = await request('me'); if (current) { setProfile(me); setStage('SignedIn'); if (googleResult === 'Linked') setMessage('Conta Google associada.') } }
        catch (failure) { if (failure.status !== 401) throw failure; const progress = await request('progress'); if (current) setStage(progress.stage) }
      } catch (failure) { if (current) { setError(failure.message); setStage('SignIn') } }
    }
    resumeGoogle()
    return () => { current = false }
  }, [googleResult, confirmationToken, invitationToken, accessEmailToken, passwordChangeToken])

  useEffect(() => { if (error) errorRef.current?.focus() }, [error])

  async function perform(action) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); setError(''); setMessage('')
    try { await action() }
    catch (failure) {
      if (failure.status === 401) {
        setRecoveryCodes([]); setProfile(null); setStage('SignIn')
      }
      setError(failure.message)
    } finally { busyRef.current = false; setBusy(false) }
  }

  async function showStage(next) {
    if (next === 'SignedIn') setProfile(await request('me'))
    setStage(next)
  }

  function submitRegistration(event) {
    event.preventDefault()
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form))
    perform(async () => {
      validatePasswordFields(data)
      const result = await request('technical-manager', data)
      form.reset(); setMessage(result.message); await showStage(result.stage)
    })
  }

  function submitSignIn(event) {
    event.preventDefault()
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form))
    perform(async () => { const result = await request('sign-in', data); form.reset(); await showStage(result.stage) })
  }

  function submitClientRegistration(data) {
    perform(async () => {
      const result = await request('client-registration', data)
      if (result.underReview && !result.saved) { setStage('ClientReview'); return }
      if (!result.saved) throw new Error(result.message)
      setMessage(result.message); setStage('ClientEmailSent')
    })
  }

  function submitFactor(event) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    perform(async () => {
      const result = await request('verify-factor', { code: data.get('code'), rememberDevice: data.get('rememberDevice') === 'on' })
        if (result.recoveryCodes?.length) { setRecoveryCodes(result.recoveryCodes); setStage('RecoveryCodes') }
      else await showStage('SignedIn')
    })
  }

  const step = ['Register', 'Invitation'].includes(stage) ? 1 : ['EmailLink', 'ConfirmEmail', 'EmailConfirmed'].includes(stage) ? 2
    : ['ConfigureAuthenticator', 'VerifyFactor', 'RecoveryCodes', 'VerifyPasskey'].includes(stage) ? 3 : stage === 'SignedIn' ? 4 : 0

  function notify(text, failure = false) { setError(failure ? text : ''); setMessage(failure ? '' : text) }
  function navigatePublic(next, serviceId = '') {
    if (document.querySelector('[data-pending-command="true"]')) return
    if ((guestSelection || document.querySelector('[data-guest-request="true"]')) && !window.confirm('Queres sair e descartar o preenchimento do pedido?')) return
    setGuestSelection(null); setPublicService(serviceId); setError(''); setMessage(''); setStage(next)
    const hash = next === 'SignIn' ? 'entrar' : next === 'PublicTherapist' ? 'terapeuta' : next === 'PublicTestimonials' ? 'testemunhos' : next === 'PublicPromotions' ? 'partilhas' : next === 'PublicAgenda' ? 'agenda' : 'inicio'
    window.history.pushState(null, '', '#' + hash + (serviceId ? '?servico=' + encodeURIComponent(serviceId) : ''))
    window.scrollTo(0, 0)
  }
  if (stage === 'SignedIn' && profile) return <Workspace profile={profile} busy={busy} perform={perform} notify={notify} error={error} message={message} errorRef={errorRef}
    onPublicTestimonials={() => navigatePublic('PublicTestimonials')}
    onSignOut={() => perform(async () => { await request('sign-out', {}); setProfile(null); setRecoveryCodes([]); setStage('SignIn') })}
    onForgetBrowser={() => perform(async () => { const result = await request('forget-browser', {}); setMessage(result.message) })}
    onPasskeyUpdated={() => showStage('SignedIn')}
    onSecuritySignedOut={text => { setProfile(null); setError(''); setMessage(text); setStage('SignIn') }}
    onAccountClosed={text => { setProfile(null); setError(''); setMessage(text); setStage('SignIn') }} />

  if (['PublicHome', 'PublicTherapist', 'PublicTestimonials', 'PublicPromotions', 'PublicAgenda'].includes(stage)) return <PublicPresentation page={stage} onNavigate={navigatePublic} profile={profile} onAccount={() => { window.history.pushState(null, '', '#inicio'); setStage('SignedIn') }}>
    {stage === 'PublicPromotions' && <PublicPromotions onAgenda={serviceId => navigatePublic('PublicAgenda', serviceId)} />}
    {stage === 'PublicTestimonials' && <PublicTestimonials onBack={() => navigatePublic('PublicHome')} />}
    {stage === 'PublicAgenda' && <VisitorAgenda key={publicService} initialServiceId={publicService} authenticated={!!profile} selection={guestSelection} onChoose={choosePublicBooking} onBack={() => setGuestSelection(null)} onSignIn={() => navigatePublic('SignIn')} />}
  </PublicPresentation>

  return (
    <AppLayout><AuthPage busy={busy} onBack={stage === 'SignIn' ? () => navigatePublic('PublicHome') : undefined} introduction={<>
          <p className="eyebrow">UM NOVO COMEÇO</p>
          <h1>O teu espaço.<br />O teu acompanhamento.</h1>
          <p>{['Register', 'Invitation'].includes(stage) ? 'Prepara a PaCT para a tua atividade, com os teus dados e acesso protegido.' : 'Acede à tua conta com uma ligação segura e os teus próprios dados.'}</p>
          {['Register', 'Invitation', 'ConfigureAuthenticator', 'VerifyFactor', 'RecoveryCodes'].includes(stage) && <ol className="steps">
            {[invitationToken ? 'Criar conta da terapeuta' : 'Criar o gestor técnico', 'Confirmar o email', 'Proteger a conta', 'Entrar na gestão'].map((label, index) =>
              <li key={label} className={step === index + 1 ? 'current' : step > index + 1 ? 'complete' : ''}><span>{step > index + 1 ? '✓' : index + 1}</span>{label}</li>)}
          </ol>}
      </>}>
          {error && <div className="notice error" role="alert" tabIndex="-1" ref={errorRef}>{error}</div>}
          {message && <div className="notice success" role="status">{message}</div>}
          {stage === 'AccessEmailLink' && <><h2>Confirma o teu novo email</h2><p>Depois de confirmares, entra com este email e a tua palavra-passe habitual.</p><button disabled={busy} onClick={() => perform(async () => { const result = await request('confirm-access-email', { token: accessEmailToken }); setMessage(result.message); setStage('AccessEmailConfirmed') })}>Confirmar novo email</button></>}
          {stage === 'AccessEmailConfirmed' && <h2>O teu email foi atualizado</h2>}
          {stage === 'GoogleReturn' && <p role="status">A concluir a entrada…</p>}
          {stage === 'PasswordChangeLink' && <><h2>Escolhe a nova palavra-passe</h2><p>Depois de guardares, entra novamente com o teu email e a nova palavra-passe.</p><form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); perform(async () => { validatePasswordFields(data); const result = await request('password-change/confirm', { token: passwordChangeToken, ...data }); form.reset(); setProfile(null); setMessage(result.message); setStage('SignIn') }) }}><PasswordField label="Nova palavra-passe" name="password" autoComplete="new-password" required minLength="12" maxLength="128" /><PasswordField label="Confirmar nova palavra-passe" name="confirmPassword" autoComplete="new-password" required minLength="12" maxLength="128" /><p className="field-help">12 a 128 caracteres, com maiúscula, minúscula, algarismo e símbolo.</p><button disabled={busy}>Guardar nova palavra-passe</button></form></>}
          {stage === 'Loading' && <p role="status">A verificar a instalação…</p>}
          {stage === 'Offline' && <><h2>Estrutura pública offline</h2><p>Retoma a ligação para entrar e consultar informação atualizada. Os formulários de uma janela fechada não são enviados depois de voltares a abrir a aplicação.</p><button disabled={!navigator.onLine} onClick={() => window.location.reload()}>Voltar a verificar a ligação</button></>}
          {stage === 'InvalidLink' && <><h2>Link inválido</h2><p>Abre apenas o link original do email de convite ou de confirmação. Não combines códigos de links diferentes.</p></>}
          {stage === 'Invitation' && <InvitedTherapistRegistration token={invitationToken} busy={busy} perform={perform} onSignIn={() => { setError(''); setStage('SignIn') }} onRegistered={async result => { setMessage(result.message); await showStage(result.stage) }} />}
          {stage === 'Insecure' && <><h2>Usa uma ligação segura</h2><p>Para criar contas e iniciar sessão, abre a aplicação pelo Visual Studio com F5, no perfil HTTPS. No PC de desenvolvimento, o endereço é https://localhost:7161.</p><p>O servidor Vite isolado não está configurado para este percurso de autenticação. Não introduzas palavras-passe num endereço HTTP.</p></>}
          {stage === 'NotPrepared' && <><p className="eyebrow">PREPARAÇÃO NECESSÁRIA</p><h2>Antes de começar</h2><p>O responsável pela instalação precisa de preparar a base de dados, as chaves e o envio de email. Não foram criadas contas.</p><p>Consulta as instruções de instalação que acompanham o projeto. Depois, atualiza esta página.</p><button onClick={() => window.location.reload()}>Voltar a verificar</button></>}
          {stage === 'Unavailable' && <><h2>Não foi possível verificar a instalação</h2><p>Confirma que a API está ativa e que abriste o endereço HTTPS pelo Visual Studio.</p><button onClick={() => window.location.reload()}>Voltar a tentar</button></>}
          {stage === 'Register' && <><p className="eyebrow">PRIMEIRO ACESSO</p><h2>Criar gestor técnico</h2><p className="muted">Esta conta prepara a instalação. Depois de ativares a segurança, poderás convidar a gestora-terapeuta.</p>
            <form onSubmit={submitRegistration}>
              <PasswordField label="Código de instalação" name="installationCode" autoComplete="off" required maxLength="256" revealLabel="código de instalação" />
              <p className="field-help">Código privado entregue ao responsável. Não é a palavra-passe da conta.</p>
              <RegistrationFields />
              <button disabled={busy} type="submit">{busy ? 'A criar a conta…' : 'Criar conta e confirmar email'}</button>
            </form><button className="text-button" disabled={busy} onClick={() => { setError(''); setStage('SignIn') }}>Já comecei a configuração — entrar</button></>}
          {stage === 'SignIn' && <><h2>Bem-vindo de volta</h2>
            <form onSubmit={submitSignIn}><label>Email<input name="email" type="email" autoComplete="username" required maxLength="256" /></label><PasswordField label="Palavra-passe" name="password" autoComplete="current-password" required maxLength="128" /><button disabled={busy}>{busy ? 'A verificar…' : 'Entrar'}</button></form><GoogleSignInButton busy={busy} perform={perform} /><button className="secondary" disabled={busy} onClick={() => { setError(''); setMessage(''); setStage('ClientRegister') }}>Criar uma conta</button></>}
          {stage === 'ClientRegister' && <><h2>Criar conta de cliente</h2><p>Preenche nome, apelido, email, telefone, nascimento, género e localidade. Depois de confirmares o email, vais definir a tua palavra-passe.</p><ClientProfileForm registration busy={busy} onSave={submitClientRegistration} /></>}
          {stage === 'ClientReview' && <><h2>Pedido em análise</h2><p>O registo não foi concluído. A gestão irá verificar o teu pedido.</p></>}
          {stage === 'ClientEmailSent' && <><h2>Confirma o teu email</h2><p>Abre a mensagem recebida, incluindo a pasta de spam. O botão do link permite confirmar o endereço e definir a palavra-passe. Ainda não foi iniciada uma sessão.</p><button className="secondary" disabled={busy} onClick={() => { setError(''); setMessage(''); setStage('ClientRegister') }}>Pedir novo email para continuar o registo</button></>}
          {stage === 'SetPassword' && <><h2>Criar a tua palavra-passe</h2><p>O email está confirmado. Define uma palavra-passe pessoal para entrar na tua conta.</p><form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); perform(async () => { validatePasswordFields(data); const result = await request('first-password', data); form.reset(); setMessage(result.message); await showStage(result.stage) }) }}><PasswordField label="Palavra-passe" name="password" autoComplete="new-password" minLength="12" maxLength="128" required /><PasswordField label="Confirmar palavra-passe" name="confirmPassword" autoComplete="new-password" minLength="12" maxLength="128" required /><p className="field-help">12 a 128 caracteres, com maiúscula, minúscula, algarismo e símbolo.</p><button disabled={busy}>Criar palavra-passe e entrar</button></form></>}
          {stage === 'EmailLink' && <><p className="eyebrow">CONFIRMAÇÃO DE EMAIL</p><h2>Confirma o teu endereço</h2><p>Carrega no botão para confirmar o email da tua conta. Abrir esta página, por si só, não confirma nada.</p><button disabled={busy} onClick={() => perform(async () => { const result = await request('confirm-email', { token: confirmationToken }); setMessage(result.message); setStage(result.stage || 'EmailConfirmed') })}>Confirmar o meu email</button></>}
          {stage === 'EmailConfirmed' && <><h2>Email confirmado</h2><p>Continua no navegador onde criaste a conta. Se não tens essa janela aberta, entra com a tua palavra-passe.</p><button disabled={busy} onClick={() => perform(async () => { try { const result = await request('progress'); await showStage(result.stage) } catch { setStage('SignIn') } })}>Continuar a configuração</button></>}
          {stage === 'ConfirmEmail' && <><p className="eyebrow">PASSO 2 DE 4</p><h2>Verifica o teu email</h2><p>A conta está criada, mas o acesso à gestão ainda não está ativo. Abre o email de confirmação, incluindo a pasta de spam, e confirma o endereço.</p><p className="field-help">A submissão ao serviço de email não garante a entrega. Se não receberes a mensagem, podes pedir um novo envio.</p>
            <button disabled={busy} onClick={() => perform(async () => { const result = await request('progress'); if (result.stage === 'ConfirmEmail') { if (['Failed', 'Uncertain'].includes(result.emailState)) throw new Error('O envio do email falhou ou não ficou confirmado. Confirma a configuração e pede um novo envio.'); setMessage('O email ainda não está confirmado. Abre a mensagem e confirma o endereço.') } else await showStage(result.stage) })}>Já confirmei o email — continuar</button>
            <button className="secondary" disabled={busy} onClick={() => perform(async () => { const result = await request('resend-email', {}); setMessage(result.message) })}>Pedir novo envio</button></>}
          {stage === 'ConfigureAuthenticator' && <><p className="eyebrow">SEGURANÇA DA CONTA</p><h2>Criar Passkey</h2><p>Regista uma Passkey para concluir o acesso à tua conta. Vais confirmar no dispositivo onde a guardares.</p><form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const password = new FormData(form).get('password'); perform(async () => { await enrollPasskey(password, 'O meu dispositivo', false); form.reset(); await showStage('SignedIn') }) }}><PasswordField label="Confirma a palavra-passe" name="password" autoComplete="current-password" required maxLength="128" /><button disabled={busy}>{busy ? 'A configurar…' : 'Criar Passkey e entrar'}</button></form></>}
          {stage === 'VerifyPasskey' && <><p className="eyebrow">CONFIRMAR ACESSO</p><h2>Entrar com Passkey</h2><p>Confirma com o desbloqueio do teu dispositivo ou com uma chave de segurança.</p><form onSubmit={event => { event.preventDefault(); const remember = new FormData(event.currentTarget).has('remember'); perform(async () => { const result = await verifyPasskey(remember); await showStage(result.stage) }) }}><label className="checkbox"><input type="checkbox" name="remember" />Reconhecer este navegador durante 30 dias</label><button disabled={busy}>{busy ? 'A confirmar…' : 'Confirmar com Passkey'}</button></form></>}
          {stage === 'VerifyFactor' && <><p className="eyebrow">CONFIRMAR ACESSO</p><h2>Código de segurança</h2><p>Introduz o código atual do Google Authenticator ou um código de recuperação ainda não utilizado.</p><FactorForm busy={busy} onSubmit={submitFactor} /></>}
          {stage === 'RecoveryCodes' && <><p className="eyebrow">GUARDA NUM LOCAL SEGURO</p><h2>Códigos de recuperação</h2><p>O autenticador está ativo. Guarda estes códigos num local seguro separado deste dispositivo. Cada código permite uma entrada se perderes o autenticador e só funciona uma vez.</p><div className="recovery-codes">{recoveryCodes.map(code => <code key={code}>{code}</code>)}</div><p className="field-help">Estes códigos não serão apresentados de novo depois de saíres. Nunca os envies para suporte ou para um chat.</p><button disabled={busy} onClick={() => perform(async () => { setRecoveryCodes([]); await showStage('SignedIn') })}>Guardei os códigos — entrar na gestão</button></>}
          {!['Loading', 'SignedIn', 'SignIn', 'Register', 'EmailLink', 'Invitation', 'InvalidLink', 'NotPrepared', 'Unavailable', 'Insecure'].includes(stage) && <button className="text-button" disabled={busy} onClick={() => { setRecoveryCodes([]); setError(''); setMessage(''); setStage('SignIn') }}>Voltar à entrada</button>}
    </AuthPage></AppLayout>
  )
}

function FactorForm({ setup = false, busy, onSubmit }) {
  return <form onSubmit={onSubmit}><label>{setup ? 'Código de 6 algarismos' : 'Código do autenticador ou de recuperação'}<input name="code" autoComplete="one-time-code" inputMode={setup ? 'numeric' : 'text'} minLength={6} maxLength={64} required /></label><label className="checkbox"><input name="rememberDevice" type="checkbox" />Reconhecer este dispositivo durante 30 dias</label><p className="field-help">Seleciona apenas num dispositivo pessoal. A palavra-passe continua a ser necessária para iniciar sessão.</p><button disabled={busy}>{busy ? 'A verificar…' : setup ? 'Ativar autenticador' : 'Confirmar e entrar'}</button></form>
}
