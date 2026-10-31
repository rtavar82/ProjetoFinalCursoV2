import CardGrid from './CardGrid'
import InformationCard from './InformationCard'
import PushConsent from './PushConsent'
import PasskeySettings from './PasskeySettings'
import AccountSecuritySettings from './AccountSecuritySettings'
import CloseAccount from './CloseAccount'
import TherapistManagement from './TherapistManagement'
import ActionButton from './ActionButton'
import { isManager } from './identityRoles'
import SessionPacksPanel from './SessionPacksPanel'

export default function AccountPage({ profile, busy, perform, notify, guard, onPasskeyUpdated, onSecuritySignedOut, onAccountClosed, onForgetBrowser, packEntry }) {
  const client = profile.role === 'Client'
  return <section aria-label="Definições da conta">
    {client && <InformationCard cardId="notifications"><PushConsent /></InformationCard>}
    <CardGrid>
      {client && <InformationCard title="As minhas sessões em pack" cardId="client-session-packs"><SessionPacksPanel key={packEntry?.revision || 'own-packs'} manager={false} disabled={busy} guard={guard} initialId={packEntry?.id} /></InformationCard>}
      <InformationCard cardId="passkeys"><PasskeySettings enabled={profile.passkeyEnabled} required={!client} busy={busy} perform={perform} onUpdated={onPasskeyUpdated} notify={notify} /></InformationCard>
      <AccountSecuritySettings busy={busy} perform={perform} notify={notify} guard={guard} onSignedOut={onSecuritySignedOut} />
      {isManager(profile.role) && <InformationCard cardId="therapist-management"><TherapistManagement busy={busy} perform={perform} /></InformationCard>}
      <InformationCard title="O navegador deste dispositivo" cardId="recognized-browser"><ActionButton variant="secondary" disabled={busy} onClick={onForgetBrowser}>Deixar de reconhecer este navegador</ActionButton></InformationCard>
      {client && <InformationCard cardId="account-closure"><CloseAccount busy={busy} perform={perform} guard={guard} onClosed={onAccountClosed} /></InformationCard>}
    </CardGrid>
  </section>
}
