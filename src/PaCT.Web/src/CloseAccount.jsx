import { request } from './identityApi'
import styles from './CloseAccount.module.css'
import PasswordField from './PasswordField'

export default function CloseAccount({ busy, perform, guard, onClosed }) {
  function submit(event) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    guard(() => perform(async () => {
      const result = await request('close-account', { password: data.get('password'), confirm: data.has('confirm') })
      form.reset()
      onClosed(result.message)
    }))
  }
  return <section className={styles.section} aria-labelledby="close-account-title">
    <h2 id="close-account-title">Encerrar conta</h2>
    <p>O acesso à conta será desativado.</p>
    <p>Encerrar a conta não elimina o saldo disponível, não liquida dívidas e não cancela marcações.</p>
    <details><summary>Quero encerrar a minha conta</summary>
      <form className={styles.form} onSubmit={submit}>
        <PasswordField label="Confirma a palavra-passe" name="password" autoComplete="current-password" required maxLength="128" />
        <label className={styles.confirm}><input name="confirm" type="checkbox" required />Compreendo que vou perder o acesso à conta.</label>
        <button disabled={busy || !navigator.onLine} type="submit">{busy ? 'A processar…' : 'Confirmar encerramento da conta'}</button>
      </form>
    </details>
  </section>
}
