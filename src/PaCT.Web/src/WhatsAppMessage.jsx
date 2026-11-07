import { useCallback, useState } from 'react'
import ActionButton from './ActionButton'
import AdaptiveSelect from './AdaptiveSelect'
import ConsultationDialog from './ConsultationDialog'
import InformationCard from './InformationCard'
import { agendaDate } from './agendaTime'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'

const readTemplates = signal => apiRequest('management/presentation/WhatsApp', undefined, { signal })

export default function WhatsAppMessage({ personId, contact, startsAt, disabled }) {
  const [open, setOpen] = useState(false)
  return <>
    <ActionButton variant="text" disabled={disabled} onClick={() => setOpen(true)}>Preparar WhatsApp</ActionButton>
    {open && <WhatsAppComposer key={personId || 'manual'} personId={personId} contact={contact} startsAt={startsAt}
      disabled={disabled} onClose={() => setOpen(false)} />}
  </>
}

function WhatsAppComposer({ personId, contact, startsAt, disabled, onClose }) {
  const readContact = useCallback(signal => apiRequest('clients/' + personId, undefined, { signal }), [personId])
  const templates = useLiveResource('management', 'whatsapp-models', readTemplates)
  const recipient = useLiveResource('clients', 'whatsapp-contact:' + personId, readContact, !!personId && !contact)
  const [key, setKey] = useState('')
  const fields = templates.data?.fields ?? []
  const template = fields.find(field => field.key === key)
  const person = contact ?? recipient.data?.data
  const phone = person?.dialCode && person?.phone ? person.dialCode + person.phone : ''
  const number = /^[1-9][0-9]{3,14}$/.test(phone) ? phone : ''
  const loading = templates.loading || recipient.loading
  const error = templates.error || recipient.error
  const name = person?.firstName?.trim()
  const values = {
    saudacao: number && name ? 'Olá, ' + name + '.' : 'Olá.',
    horario: number && startsAt && Number.isFinite(Date.parse(startsAt)) ? ' para ' + agendaDate(startsAt) : '',
  }
  const message = template?.value.replace(/\{(saudacao|horario)\}/g, (_, token) => values[token]).trim() || ''
  const link = 'https://wa.me/' + number + '?text=' + encodeURIComponent(message)
  return <ConsultationDialog title="Preparar WhatsApp" label="Mensagem de WhatsApp" onClose={onClose}>
    <InformationCard cardId="whatsapp-message" loading={loading} error={error}
      onRetry={templates.error ? templates.refresh : recipient.refresh}>
      {!loading && !error && <>
        {number ? <p>Destinatário <strong>{[name, person.lastName].filter(Boolean).join(' ')} · +{number}</strong></p>
          : <p>{person ? 'Esta ficha não tem um telefone válido para abrir a conversa direta. ' : ''}A mensagem é genérica. Escolhe o contacto no WhatsApp.</p>}
        <label>Modelo da mensagem
          <AdaptiveSelect value={key} disabled={disabled} onChange={event => setKey(event.target.value)}>
            <option value="">Escolhe um modelo</option>
            {fields.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}
          </AdaptiveSelect>
        </label>
        {message && <>
          <label>Pré-visualização<textarea rows={4} readOnly value={message} /></label>
          <p>Confirma o destinatário e envia a mensagem no WhatsApp.</p>
          {!disabled && <a href={link} target="_blank" rel="noopener noreferrer">Abrir no WhatsApp</a>}
        </>}
      </>}
    </InformationCard>
  </ConsultationDialog>
}
