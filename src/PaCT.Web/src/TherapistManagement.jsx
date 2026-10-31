import styles from './TherapistManagement.module.css'
import { useEffect, useState } from 'react'
import { request } from './identityApi'
import { observeResource } from './liveUpdates'

const therapistStates = { ConfirmEmail: 'Aguarda confirmação do email', ConfigureAuthenticator: 'Aguarda configuração da Passkey', Ready: 'Acesso ativo · email confirmado e 2FA', Closed: 'Conta encerrada' }
const invitationStates = { Pending: 'Convite pendente', Expired: 'Convite expirado', Cancelled: 'Convite cancelado', Accepted: 'Convite utilizado' }
const emailStates = { Pending: 'Email em fila de envio.', Sending: 'Envio em curso.', Submitted: 'Mensagem aceite pelo servidor de email. Verifica a receção com a destinatária.', Failed: 'O envio falhou. Podes pedir um novo convite.', Uncertain: 'Não foi possível confirmar o envio. Confirma a receção antes de repetir.', Cancelled: 'O envio anterior foi cancelado ou substituído.' }
const date = value => new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Lisbon' }).format(new Date(value))

export default function TherapistManagement({ busy, perform }) {
  const [state, setState] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    let current = true
    const stop = observeResource('accountSecurity', async () => {
      try { const value = await request('therapist-management'); if (current) { setState(value); setLoadError('') } }
      catch (error) { if (current) setLoadError(error.message) }
    })
    return () => { current = false; stop() }
  }, [])

  async function reload() { setState(await request('therapist-management')); setLoadError('') }
  function invite(event) {
    event.preventDefault()
    const form = event.currentTarget
    const email = new FormData(form).get('email')
    perform(async () => {
      setMessage('')
      const result = await request('therapist-invitations', { email, replaceInvitationId: replaceId })
      form.reset(); setMessage(result.message); await reload()
    })
  }
  const invitation = state?.invitation
  const replaceId = invitation && ['Pending', 'Expired'].includes(invitation.state) ? invitation.id : null
  return <section className={`${styles.page} therapist-management`} aria-labelledby="therapist-heading">
    <p className="eyebrow">A TUA EQUIPA</p><h3 id="therapist-heading">Gestora-terapeuta</h3>
    {loadError && <p className="notice error" role="alert">{loadError}</p>}
    {message && <p className="notice success" role="status">{message}</p>}
    {!state && !loadError && <p role="status">A consultar o estado…</p>}
    {state?.therapist ? <><div className="invitation-status"><strong>{state.therapist.displayName}</strong><p>{state.therapist.email}</p><span>{therapistStates[state.therapist.state]}</span></div><p className="field-help">Esta instalação tem uma única conta permanente de gestora-terapeuta. Um registo incompleto é retomado pela própria destinatária, sem criar outra conta.</p></> : state && <>
      <p>Convida a pessoa que será responsável pelo acompanhamento terapêutico. Ela define os seus dados e palavra-passe, confirma o email e regista uma Passkey.</p>
      {invitation && <div className="invitation-status"><strong>{invitationStates[invitation.state]}</strong><p>{invitation.email}</p><p>Enviado em {date(invitation.createdAtUtc)} · Lisboa<br />Validade até {date(invitation.expiresAtUtc)} · Lisboa</p><p>{emailStates[invitation.emailState]}</p></div>}
      <form key={invitation?.id || 'first-invitation'} onSubmit={invite}>
        <label>Email da gestora-terapeuta<input name="email" type="email" autoComplete="email" maxLength="256" defaultValue={invitation?.email || ''} required /></label>
        {replaceId && <label className="checkbox"><input type="checkbox" required />Compreendo que o convite anterior deixará de funcionar.</label>}
        <p className="field-help">O link é pessoal, utilizável uma única vez e válido durante 24 horas. Não é criada uma conta antes de a destinatária aceitar o convite.</p>
        <button disabled={busy}>{busy ? 'A guardar o convite…' : replaceId ? 'Reenviar ou substituir convite' : 'Enviar convite'}</button>
      </form>
      {replaceId && <button className="secondary" disabled={busy} onClick={() => perform(async () => {
        setMessage(''); const result = await request(`therapist-invitations/${replaceId}/cancel`, {}); setMessage(result.message); await reload()
      })}>Cancelar este convite</button>}
    </>}
  </section>
}
