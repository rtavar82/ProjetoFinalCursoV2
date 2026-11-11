import ActionButton from './ActionButton'
import InformationCard from './InformationCard'
import PrivacyPolicy from './PrivacyPolicy'
import PushConsent from './PushConsent'
import { usePrivacy } from './privacyContext'
import { agendaDate } from './agendaTime'

export default function ClientPrivacyCard({ view }) {
  const privacy = usePrivacy()
  if (!privacy?.policy) {
    return view === 'notifications' ? <PushConsent /> : <p>Ainda não existe uma política de privacidade publicada.</p>
  }
  const { policy, choices, reading, push, busy, error, decide } = privacy
  const confirmed = reading?.version === policy.version && reading.accepted
  return <InformationCard variant="plain" cardId="client-privacy" loading={choices.loading} error={choices.error} onRetry={choices.refresh} data-pending-command={busy || undefined}>
    {view === 'policy' && <>
      {policy.testOnly && <p>Versão de teste</p>}
      {choices.data && <>
        <p>Leitura da versão {policy.version}: {confirmed ? 'confirmada' : 'por confirmar'}.</p>
        {!confirmed && <ActionButton variant="secondary" disabled={busy} onClick={() => decide('reading', true)}>Confirmar leitura</ActionButton>}
      </>}
      <details><summary>Ler a política completa</summary><PrivacyPolicy content={policy.content} /></details>
    </>}
    {view === 'notifications' && <>
      <p>{policy.content.pushNotice}</p>
      {choices.data && <ActionButton variant="secondary" disabled={busy} onClick={() => decide('push', !push?.accepted)}>
        {push?.accepted ? 'Retirar autorização de notificações' : 'Autorizar notificações'}
      </ActionButton>}
      <PushConsent disabled={busy} />
    </>}
    {view === 'history' && choices.data && (choices.data.length === 0
      ? <p>Ainda não existem escolhas registadas.</p>
      : <ul>{choices.data.map((choice, index) => <li key={index}>{agendaDate(choice.decidedAt)} · Versão {choice.version} ·
        {' '}{choice.purpose === 'reading' ? (choice.accepted ? 'Leitura confirmada' : 'Leitura adiada') : (choice.accepted ? 'Notificações autorizadas' : 'Notificações não autorizadas')}</li>)}</ul>)}
    {error && <p className="notice error" role="alert">{error}</p>}
  </InformationCard>
}
