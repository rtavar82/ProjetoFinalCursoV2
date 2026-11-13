import { useId, useRef, useState } from 'react'
import ActionButton from './ActionButton'
import DisclosureSummary from './DisclosureSummary'
import InformationCard from './InformationCard'
import { showSuccess } from './actionNotices'
import { readPublicPresentation } from './publicPresentationData'
import useLiveResource from './useLiveResource'

export default function EmailChangeRequest({ client, disabled = false }) {
  const [open, setOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [copyError, setCopyError] = useState('')
  const emailInput = useRef(null)
  const copyId = useId()
  const contacts = useLiveResource('publicPresentation', 'public-presentation', readPublicPresentation, open)
  const currentEmail = client.data.email || ''
  const name = [client.data.firstName, client.data.lastName].filter(Boolean).join(' ')
  const message = `Olá, sou ${name}. Pretendo alterar o meu email de acesso de ${currentEmail} para ${newEmail.trim()}. Podem iniciar a alteração? Obrigado/a.`
  const mail = 'mailto:?subject=' + encodeURIComponent('Pedido de alteração do email de acesso') + '&body=' + encodeURIComponent(message)
  const whatsapp = contacts.data?.therapist.whatsapp
  function validate(event) {
    const input = emailInput.current
    input.setCustomValidity(newEmail.trim().toLocaleLowerCase() === currentEmail.trim().toLocaleLowerCase()
      ? 'Indica um email diferente do atual.' : '')
    const valid = !disabled && input.reportValidity()
    if (!valid) event?.preventDefault()
    return valid
  }
  async function copy() {
    if (!validate()) return
    setCopyError('')
    try { await navigator.clipboard.writeText(message); showSuccess('Mensagem copiada. Envia-a à gestão pelo meio que preferires.') }
    catch { setCopyError('Não foi possível copiar. Seleciona e copia a mensagem abaixo.') }
  }
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <DisclosureSummary>Como alterar o email</DisclosureSummary>
    <InformationCard as="div" variant="plain">
      <ol>
        <li>Indica o novo email e envia o pedido à gestão.</li>
        <li>Depois de a gestão iniciar a alteração, receberás uma ligação no novo endereço.</li>
        <li>Abre a ligação e confirma a alteração no prazo de 24 horas. Até lá, continuas a entrar com o email atual.</li>
      </ol>
      <label>Novo email pretendido
        {/* This contact request is independent of the profile form and never enters its submission or recovery. */}
        <input ref={emailInput} type="email" form="" required maxLength={256} autoComplete="off" inputMode="email"
          value={newEmail} disabled={disabled} onChange={event => { emailInput.current.setCustomValidity(''); setNewEmail(event.target.value); setCopyError('') }}
          onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} />
      </label>
      <p className="field-help">Revê e envia a mensagem na aplicação escolhida. No email, escolhe também o destinatário da gestão. Nada é enviado automaticamente.</p>
      <div className="button-row">
        <a href={disabled ? undefined : mail} aria-disabled={disabled || undefined} onClick={validate}>Pedir por email</a>
        {whatsapp && <a href={disabled ? undefined : whatsapp + '?text=' + encodeURIComponent(message)} target="_blank" rel="noopener noreferrer"
          aria-disabled={disabled || undefined} onClick={validate}>Pedir por WhatsApp</a>}
        <ActionButton variant="text" disabled={disabled} onClick={copy}>Copiar mensagem</ActionButton>
      </div>
      {contacts.loading && <p className="field-help" role="status">A carregar o contacto de WhatsApp…</p>}
      {contacts.error && <div role="alert"><p className="field-help">Não foi possível carregar o contacto de WhatsApp.</p><ActionButton variant="text" onClick={contacts.refresh}>Voltar a tentar</ActionButton></div>}
      {contacts.data && !whatsapp && <p className="field-help">O contacto de WhatsApp ainda não está disponível. Usa email ou copia a mensagem.</p>}
      {copyError && <><p role="alert" className="field-help">{copyError}</p><div><label htmlFor={copyId}>Mensagem para copiar</label><textarea id={copyId} form="" rows={5} readOnly value={message} /></div></>}
    </InformationCard>
  </details>
}
