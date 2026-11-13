import DisclosureSummary from './DisclosureSummary'
import { useCallback, useId, useRef } from 'react'
import { apiRequest } from './identityApi'
import PasswordField from './PasswordField'
import useLiveResource from './useLiveResource'
import styles from './AccountAccessSettings.module.css'
import ActionButton from './ActionButton'

export default function AccountAccessSettings({ client, busy, perform, notify, inline = false, therapist = false }) {
  const path = therapist ? 'identity/therapist-management/access' : `clients/${client.id}/access`
  const titleId = useId()
  const read = useCallback(() => apiRequest(path), [path])
  const { data: status, error } = useLiveResource('clientAccess', path, read)
  function submit(form, kind, operationId, confirmed) {
    const data = new FormData(form)
    const input = { operationId, version: status.version, password: data.get('password'), confirmIdentity: data.has('confirmIdentity') }
    if (kind === 'email') input.newEmail = data.get('newEmail')
    perform(async () => {
      const result = await apiRequest(`${path}/${kind}`, input)
      form.reset(); confirmed(); notify(result.message)
    })
  }
  return <section className={`${styles.section} ${inline ? styles.inline : ''}`} aria-labelledby={titleId}>
    <h3 id={titleId}>Acesso e segurança</h3>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!status && !error && <p role="status">A carregar a segurança da conta…</p>}
    {status && <>
      <p>Passkeys registadas: {status.passkeyCount}</p>
      {status.pendingEmailChange && <p className="notice" role="status">A aguardar confirmação de <strong>{status.pendingEmailChange.email}</strong>. O email atual mantém-se até à confirmação.</p>}
      <AccessAction kind="email" busy={busy} therapist={therapist} onSubmit={submit} />
      <AccessAction kind="reset-passkeys" busy={busy || therapist && status.passkeyCount === 0} therapist={therapist} onSubmit={submit} />
    </>}
  </section>
}

function AccessAction({ kind, busy, therapist, onSubmit }) {
  const operationId = useRef(crypto.randomUUID())
  const email = kind === 'email'
  return <details className={styles.action}>
    <DisclosureSummary>{email ? 'Alterar email de acesso' : therapist ? 'Apagar Passkeys da terapeuta' : 'Repor Passkeys'}</DisclosureSummary>
    <p>{email ? therapist ? 'A terapeuta confirma o novo endereço por email. A palavra-passe e as Passkeys mantêm-se.' : 'O cliente confirma o novo endereço por email e continua a usar a mesma palavra-passe e as mesmas Passkeys.'
      : therapist ? 'Remove todas as Passkeys da terapeuta e termina os acessos anteriores. Mantém a palavra-passe. Na próxima entrada, terá de registar uma nova Passkey antes de aceder à gestão.'
        : 'Remove todas as Passkeys desta conta e termina os acessos anteriores. O cliente poderá entrar com a mesma palavra-passe e escolher se quer registar uma nova Passkey.'}</p>
    <form data-explicit-submit data-protect-draft onSubmit={event => { event.preventDefault(); onSubmit(event.currentTarget, kind, operationId.current, () => { operationId.current = crypto.randomUUID() }) }}>
      {email && <label>Novo email de acesso<input name="newEmail" type="email" autoComplete="off" required maxLength="256" onChange={() => { operationId.current = crypto.randomUUID() }} /></label>}
      <PasswordField label="A tua palavra-passe de gestão" name="password" required maxLength="128" autoComplete="current-password" />
      <label className="checkbox"><input name="confirmIdentity" type="checkbox" required />{therapist ? 'Verifiquei a identidade da terapeuta e confirmo esta alteração.' : 'Verifiquei a identidade do cliente e confirmo esta alteração.'}</label>
      <ActionButton type="submit" disabled={busy}>{email ? 'Enviar confirmação para o novo email' : 'Confirmar reposição das Passkeys'}</ActionButton>
    </form>
  </details>
}
