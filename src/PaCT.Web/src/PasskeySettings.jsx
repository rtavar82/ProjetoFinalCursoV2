import { enrollPasskey } from './passkeys'
import styles from './PasskeySettings.module.css'
import PasswordField from './PasswordField'

export default function PasskeySettings({ enabled, required, busy, perform, onUpdated, notify }) {
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
  return <section className={styles.panel}><h2>Passkeys</h2>
    <p>Com uma Passkey, proteges a tua conta com autenticação de dois fatores (2FA): depois da palavra-passe, confirmas a entrada no teu dispositivo.</p>
    <p>{enabled ? 'A tua conta está protegida com Passkey.' : required ? 'Regista uma Passkey para concluir o acesso à tua conta.' : 'Se quiseres ativar esta proteção, regista uma Passkey abaixo.'}</p>
    {!enabled && !required && <p>Se reconheceres este navegador, durante 30 dias só precisas da palavra-passe para entrar. Depois, voltas a confirmar com a Passkey e podes escolher mais 30 dias. Sem esta opção, precisas da Passkey em cada nova entrada. Escolhe-a apenas num dispositivo pessoal.</p>}
    {enabled ? <details><summary>Registar outra Passkey como alternativa</summary>{form}</details> : form}
    <p>A impressão digital, o reconhecimento facial ou o PIN são tratados pelo dispositivo. Não são enviados para a PaCT.</p>
  </section>
}
