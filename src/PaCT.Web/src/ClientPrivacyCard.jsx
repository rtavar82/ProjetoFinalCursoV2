import ActionButton from './ActionButton'
import InformationCard from './InformationCard'
import { PrivacyLink } from './PrivacyProvider'
import { privacyTitle } from './PrivacyPolicy'
import { usePrivacy } from './privacyContext'
import { agendaDate } from './agendaTime'

export default function ClientPrivacyCard() {
  const privacy = usePrivacy()
  if (!privacy?.policy) return null
  const { policy, choices, reading, push, busy, error, decide } = privacy
  return <InformationCard title={privacyTitle} cardId="client-privacy" loading={choices.loading} error={choices.error} onRetry={choices.refresh}>
    <PrivacyLink label="Ler a política completa" />
    {choices.data && <>
      <p>Leitura da versão {policy.version}: {reading?.version === policy.version && reading.accepted ? 'confirmada' : 'por confirmar'}.</p>
      {!(reading?.version === policy.version && reading.accepted) &&
        <ActionButton variant="secondary" disabled={busy} onClick={() => decide('reading', true)}>Confirmar leitura</ActionButton>}
      <p>{policy.content.pushNotice}</p>
      <ActionButton variant="secondary" disabled={busy} onClick={() => decide('push', !push?.accepted)}>
        {push?.accepted ? 'Retirar autorização de notificações' : 'Autorizar notificações'}
      </ActionButton>
      {choices.data.length > 0 && <details><summary>Histórico das minhas escolhas</summary>
        {choices.data.map((choice, index) => <p key={index}>{agendaDate(choice.decidedAt)} · Versão {choice.version} ·
          {' '}{choice.purpose === 'reading' ? (choice.accepted ? 'Leitura confirmada' : 'Leitura adiada') : (choice.accepted ? 'Notificações autorizadas' : 'Notificações não autorizadas')}</p>)}
      </details>}
    </>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </InformationCard>
}
