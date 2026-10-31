import { useRef } from 'react'
import { request } from './identityApi'
import PasswordField from './PasswordField'
import styles from './AccountSecuritySettings.module.css'
import InformationCard from './InformationCard'
import useLiveResource from './useLiveResource'

const readGoogle = () => request('google/status')

export function GoogleSignInButton({ busy, perform }) {
  const { data } = useLiveResource('accountSecurity', 'google-status', readGoogle)
  const enabled = data?.enabled
  return enabled && <button type="button" className={`secondary ${styles.googleSignIn}`} disabled={busy || !navigator.onLine} onClick={() => perform(async () => {
    const result = await request('google/start', { mode: 'SignIn' })
    if (result.url !== '/api/identity/google/challenge') throw new Error('Não foi possível iniciar a entrada com Google.')
    window.location.assign(result.url)
  })}><span>Entrar com a conta</span><img className={styles.googleWordmark} src="/google-wordmark.svg" alt="Google" width="74" height="24" /></button>
}

export default function AccountSecuritySettings({ busy, perform, notify, guard, onSignedOut }) {
  const { data: google, error } = useLiveResource('accountSecurity', 'google-status', readGoogle)
  const operationId = useRef(crypto.randomUUID())
  function passwordChange(event) {
    event.preventDefault(); const form = event.currentTarget
    const password = new FormData(form).get('password')
    perform(async () => {
      const result = await request('password-change', { operationId: operationId.current, password })
      form.reset(); operationId.current = crypto.randomUUID(); notify(result.message)
    })
  }
  function googleChange(event) {
    event.preventDefault(); const form = event.currentTarget; const password = new FormData(form).get('password')
    guard(() => perform(async () => {
      const result = await request(google.linked ? 'google/unlink' : 'google/start', { mode: 'Link', password })
      form.reset()
      if (google.linked) { onSignedOut(result.message); return }
      if (result.url !== '/api/identity/google/challenge') throw new Error('Não foi possível associar o Google.')
      window.location.assign(result.url)
    }))
  }
  return <>
    <InformationCard cardId="password-settings"><section className={styles.section} aria-labelledby="password-settings-title">
      <h3 id="password-settings-title">Palavra-passe</h3>
      <details className={styles.action}><summary>Alterar palavra-passe</summary>
        <p>Recebe um email com o link para escolheres a nova palavra-passe.</p>
        <form onSubmit={passwordChange}><PasswordField label="Palavra-passe atual" name="password" autoComplete="current-password" required maxLength="128" />
          <button disabled={busy}>Enviar email para alterar a palavra-passe</button>
        </form>
      </details>
    </section></InformationCard>
    <InformationCard cardId="google-settings"><section className={styles.section} aria-labelledby="google-settings-title">
      <h3 id="google-settings-title">Google</h3>
      {error && <p className="notice error" role="alert">{error}</p>}
      {google?.linked && <p>Conta Google associada: {google.email}</p>}
      {google?.enabled === false && !google.linked && <p>A entrada com Google ainda não está disponível.</p>}
      {(google?.enabled || google?.linked) && <details className={styles.action}><summary>{google.linked ? 'Desassociar Google' : 'Associar conta Google'}</summary>
        <p>{google.linked ? 'Poderás continuar a entrar com o teu email e a palavra-passe.' : 'Usa a tua conta Google para entrar. A tua palavra-passe e as Passkeys mantêm-se.'}</p>
        <form onSubmit={googleChange}><PasswordField label="Confirma a tua palavra-passe" name="password" autoComplete="current-password" required maxLength="128" />
          <button disabled={busy}>{google.linked ? 'Confirmar desassociação' : 'Continuar para o Google'}</button>
        </form>
      </details>}
    </section></InformationCard>
  </>
}
