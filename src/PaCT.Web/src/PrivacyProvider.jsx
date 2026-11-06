import { useRef, useState } from 'react'
import ActionButton from './ActionButton'
import ConsultationDialog from './ConsultationDialog'
import Heading from './Heading'
import PrivacyPolicy, { privacyTitle } from './PrivacyPolicy'
import { PrivacyContext, usePrivacy } from './privacyContext'
import useLiveResource from './useLiveResource'
import { apiRequest } from './identityApi'
import styles from './PrivacyProvider.module.css'

const visitorKey = 'pact:privacy-reading'
function visitorVersion() {
  try { return Number(localStorage.getItem(visitorKey)) }
  catch { return 0 }
}
const readPolicy = signal => apiRequest('privacy', undefined, { signal, publicOnly: true })
const readChoices = signal => apiRequest('privacy/choices', undefined, { signal })

export default function PrivacyProvider({ client, visitor, available, children }) {
  const resource = useLiveResource('privacy', 'policy', readPolicy, available)
  const policy = resource.data?.policy
  const choices = useLiveResource('privacy', 'choices', readChoices, client && !!policy)
  const [visitorRead, setVisitorRead] = useState(visitorVersion)
  const [dismissed, setDismissed] = useState({})
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(null)
  const reading = choices.data?.find(choice => choice.purpose === 'reading')
  const push = choices.data?.find(choice => choice.purpose === 'push' && choice.version === policy?.version)
  const acknowledged = client ? reading?.accepted && reading.version === policy?.version : visitorRead === policy?.version

  async function decide(purpose, accepted) {
    if (busy || !policy) return
    setError('')
    if (visitor) {
      if (accepted) {
        try { localStorage.setItem(visitorKey, String(policy.version)) }
        catch { /* Keep the acknowledgement for this visit if storage is unavailable. */ }
        setVisitorRead(policy.version)
      }
      setDismissed(current => ({ ...current, reading: policy.version }))
      return
    }
    const input = pending.current?.purpose === purpose && pending.current?.accepted === accepted && pending.current?.version === policy.version
      ? pending.current : { purpose, accepted, version: policy.version, operationId: crypto.randomUUID() }
    pending.current = input
    setBusy(true)
    try {
      const result = await apiRequest('privacy/choices', input)
      if (result.purpose !== purpose || result.accepted !== accepted || result.version !== input.version)
        throw new Error('Não foi possível confirmar a escolha. Volta a tentar.')
      pending.current = null
      setDismissed(current => ({ ...current, [purpose]: policy.version }))
    } catch (failure) {
      setError(failure.message)
      if (failure.status === 409) resource.refresh()
    } finally { setBusy(false) }
  }

  const ready = visitor || client && !!choices.data && !choices.error
  const promptReading = available && ready && policy && !acknowledged && dismissed.reading !== policy.version
  const promptPush = available && ready && policy && client && !push?.accepted && dismissed.push !== policy.version
  return <PrivacyContext.Provider value={{ policy, client, choices, reading, push, decide, busy, error, open: () => setOpen(true) }}>
    {children}
    {(promptReading || promptPush) && <aside className={styles.notice} aria-label={privacyTitle}>
      {policy.testOnly && <p className="eyebrow">Versão de teste</p>}
      {promptReading ? <>
        <Heading level={2}>{privacyTitle}</Heading>
        <p>{policy.content.summary}</p>
        <PrivacyLink label="Ler a política completa" />
        <div className="button-row">
          <ActionButton variant="secondary" disabled={busy} onClick={() => decide('reading', false)}>Agora não</ActionButton>
          <ActionButton disabled={busy} onClick={() => decide('reading', true)}>Confirmar leitura</ActionButton>
        </div>
      </> : <>
        <Heading level={2}>Notificações opcionais</Heading>
        <p>{policy.content.pushNotice}</p>
        <div className="button-row">
          <ActionButton variant="secondary" disabled={busy} onClick={() => decide('push', false)}>Não autorizar</ActionButton>
          <ActionButton disabled={busy} onClick={() => decide('push', true)}>Autorizar notificações</ActionButton>
        </div>
      </>}
      {error && <p className="notice error" role="alert">{error}</p>}
    </aside>}
    {open && policy && <ConsultationDialog title={privacyTitle} label={privacyTitle} onClose={() => setOpen(false)}>
      <p className="muted">{policy.testOnly ? 'Versão de teste' : 'Versão'} {policy.version}</p>
      <PrivacyPolicy content={policy.content} />
    </ConsultationDialog>}
  </PrivacyContext.Provider>
}

export function PrivacyLink({ label = privacyTitle }) {
  const privacy = usePrivacy()
  return privacy?.policy && <ActionButton variant="text" onClick={privacy.open}>{label}</ActionButton>
}

