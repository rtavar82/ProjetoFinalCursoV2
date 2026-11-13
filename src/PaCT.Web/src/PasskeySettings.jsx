import DisclosureSummary from './DisclosureSummary'
import { enrollPasskey } from './passkeys'
import styles from './PasskeySettings.module.css'
import PasswordField from './PasswordField'

export default function PasskeySettings({ enabled, required, busy, perform, onUpdated, notify, inline = false }) {
  function submit(event) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form)
    perform(async () => {
      const result = await enrollPasskey(data.get('password'), data.get('name'), data.has('remember'))
      form.reset(); await onUpdated(); notify(result.message)
    })
  }
  const form = <form data-protect-draft onSubmit={submit}>
      <label>Nome da Passkey<input name="name" maxLength="100" defaultValue="O meu dispositivo" required autoComplete="off" /></label>
      <PasswordField label="Confirmar palavra-passe atual" name="password" autoComplete="current-password" required maxLength="128" />
      <label className="checkbox"><input name="remember" type="checkbox" />Reconhecer este navegador durante 30 dias</label>
      <button disabled={busy}>{busy ? 'A confirmar…' : 'Registar Passkey neste dispositivo'}</button>
    </form>
  return <section className={styles.panel}>{!inline && <h2>Passkeys</h2>}
    <p>A Passkey acrescenta uma confirmação de segurança à entrada, depois da palavra-passe.</p>
    <p>{enabled ? 'A tua conta está protegida com Passkey.' : required ? 'Regista uma Passkey para concluir o acesso à tua conta.' : 'Se quiseres ativar esta proteção, regista uma Passkey abaixo.'}</p>
    {!enabled && !required && <p>Num dispositivo pessoal, podes dispensar a Passkey neste navegador durante 30 dias. Continuas a precisar da palavra-passe.</p>}
    {enabled ? <details><DisclosureSummary>Registar outra Passkey como alternativa</DisclosureSummary>{form}</details> : form}
    <p>A impressão digital, o rosto e o PIN ficam no dispositivo; não são enviados à PaCT.</p>
  </section>
}
