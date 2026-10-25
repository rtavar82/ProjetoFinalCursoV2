import { useState } from 'react'
import { request } from './identityApi'
import RegistrationFields from './RegistrationFields'
import { validatePasswordFields } from './registrationValidation'

export default function InvitedTherapistRegistration({ token, busy, perform, onRegistered, onSignIn }) {
  const [invitation, setInvitation] = useState(null)
  function register(event) {
    event.preventDefault()
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form))
    perform(async () => {
      validatePasswordFields(data)
      const result = await request('therapist-registration', { ...data, token })
      form.reset(); await onRegistered(result)
    })
  }
  return <><p className="eyebrow">CONVITE PESSOAL</p><h2>Criar conta de gestora-terapeuta</h2>
    <p>Recebeste um convite do gestor técnico. Abrir esta página não cria uma conta nem ativa o acesso à gestão.</p>
    {!invitation ? <button disabled={busy} onClick={() => perform(async () => setInvitation(await request('therapist-invitation/preview', { token })))}>Ver convite e continuar</button> : <>
      <div className="invitation-status"><span>Este convite destina-se a</span><p><strong>{invitation.email}</strong></p></div>
      <p className="field-help">O email do convite não pode ser alterado neste registo. Se estiver errado, pede um novo convite ao gestor técnico. Usa uma janela privada se este navegador já tiver outra conta iniciada.</p>
      <form onSubmit={register}><RegistrationFields includeEmail={false} /><button disabled={busy}>{busy ? 'A criar a conta…' : 'Aceitar convite e criar conta'}</button></form>
    </>}
    <button className="text-button" disabled={busy} onClick={onSignIn}>Já criei a conta — entrar</button>
  </>
}
