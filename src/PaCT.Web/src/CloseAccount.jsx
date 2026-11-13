import DisclosureSummary from './DisclosureSummary'
import { request } from './identityApi'
import styles from './CloseAccount.module.css'
import PasswordField from './PasswordField'

export default function CloseAccount({ busy, perform, guard, onClosed, inline = false }) {
  function submit(event) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    guard(() => perform(async () => {
      const result = await request('close-account', { password: data.get('password'), confirm: data.has('confirm') })
      form.reset()
      onClosed(result.message)
    }), inline ? form : undefined)
  }
  return <section className={styles.section} aria-labelledby={inline ? undefined : 'close-account-title'}>
    {!inline && <h2 id="close-account-title">Encerrar conta</h2>}
    <p>O acesso à conta será desativado.</p>
    <p>Encerrar a conta não elimina o saldo disponível, não liquida dívidas e não cancela marcações.</p>
    <details><DisclosureSummary>Quero encerrar a minha conta</DisclosureSummary>
      <form className={styles.form} data-protect-draft={inline || undefined} onSubmit={submit}>
        <PasswordField label="Confirma a palavra-passe" name="password" autoComplete="current-password" required maxLength="128" />
        <label className="checkbox"><input name="confirm" type="checkbox" required /><span>Compreendo que vou perder o acesso à conta.</span></label>
        <button disabled={busy} type="submit">{busy ? 'A processar…' : 'Confirmar encerramento da conta'}</button>
      </form>
    </details>
  </section>
}
