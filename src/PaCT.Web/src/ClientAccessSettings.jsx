import { useEffect, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import PasswordField from './PasswordField'
import styles from './ClientAccessSettings.module.css'

export default function ClientAccessSettings({ client, busy, perform, notify }) {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const path = `clients/${client.id}/access`
  useEffect(() => {
    let current = true
    apiRequest(path).then(data => { if (current) { setStatus(data); setError('') } })
      .catch(failure => { if (current) setError(failure.message) })
    return () => { current = false }
  }, [path, revision])
  function submit(form, kind, operationId, confirmed) {
    const data = new FormData(form)
    const input = { operationId, version: status.version, password: data.get('password'), confirmIdentity: data.has('confirmIdentity') }
    if (kind === 'email') input.newEmail = data.get('newEmail')
    perform(async () => {
      const result = await apiRequest(`${path}/${kind}`, input)
      form.reset(); confirmed(); notify(result.message)
      setRevision(value => value + 1)
    })
  }
  return <section className={styles.section} aria-labelledby="client-access-title">
    <h3 id="client-access-title">Acesso e segurança</h3>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!status && !error && <p role="status">A carregar a segurança da conta…</p>}
    <button type="button" className="secondary" disabled={busy} onClick={() => setRevision(value => value + 1)}>Atualizar segurança da conta</button>
    {status && <>
      <p>Passkeys registadas: {status.passkeyCount}</p>
      {status.pendingEmailChange && <p className="notice" role="status">A aguardar confirmação de <strong>{status.pendingEmailChange.email}</strong>. O email atual mantém-se até à confirmação.</p>}
      <AccessAction kind="email" busy={busy} onSubmit={submit} />
      <AccessAction kind="reset-passkeys" busy={busy} onSubmit={submit} />
    </>}
  </section>
}

function AccessAction({ kind, busy, onSubmit }) {
  const operationId = useRef(crypto.randomUUID())
  const email = kind === 'email'
  return <details className={styles.action}>
    <summary>{email ? 'Alterar email de acesso' : 'Repor Passkeys'}</summary>
    <p>{email ? 'O cliente confirma o novo endereço por email e continua a usar a mesma palavra-passe e as mesmas Passkeys.'
      : 'Remove todas as Passkeys desta conta e termina os acessos anteriores. O cliente poderá entrar com a mesma palavra-passe e escolher se quer registar uma nova Passkey.'}</p>
    <form data-protect-draft onSubmit={event => { event.preventDefault(); onSubmit(event.currentTarget, kind, operationId.current, () => { operationId.current = crypto.randomUUID() }) }}>
      {email && <label>Novo email de acesso<input name="newEmail" type="email" autoComplete="off" required maxLength="256" onChange={() => { operationId.current = crypto.randomUUID() }} /></label>}
      <PasswordField label="A tua palavra-passe de gestão" name="password" required maxLength="128" autoComplete="current-password" />
      <label className="checkbox"><input name="confirmIdentity" type="checkbox" required />Verifiquei a identidade do cliente e confirmo esta alteração.</label>
      <button disabled={busy || !navigator.onLine}>{email ? 'Enviar confirmação para o novo email' : 'Confirmar reposição das Passkeys'}</button>
    </form>
  </details>
}
