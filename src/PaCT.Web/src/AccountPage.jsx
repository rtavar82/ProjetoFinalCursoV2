import CardGrid from './CardGrid'
import InformationCard from './InformationCard'
import PasskeySettings from './PasskeySettings'
import AccountSecuritySettings from './AccountSecuritySettings'
import TherapistManagement from './TherapistManagement'
import ActionButton from './ActionButton'
import { isManager } from './identityRoles'
import ClientAccountPage from './ClientAccountPage'

export default function AccountPage(props) {
  const { profile, busy, perform, notify, guard, onPasskeyUpdated, onSecuritySignedOut, onForgetBrowser } = props
  if (profile.role === 'Client') return <ClientAccountPage {...props} />
  return <section aria-label="Definições da conta">
    <CardGrid>
      <InformationCard cardId="passkeys"><PasskeySettings enabled={profile.passkeyEnabled} required busy={busy} perform={perform} onUpdated={onPasskeyUpdated} notify={notify} /></InformationCard>
      <AccountSecuritySettings busy={busy} perform={perform} notify={notify} guard={guard} onSignedOut={onSecuritySignedOut} />
      {isManager(profile.role) && <InformationCard cardId="therapist-management"><TherapistManagement busy={busy} perform={perform} /></InformationCard>}
      <InformationCard title="O navegador deste dispositivo" cardId="recognized-browser"><ActionButton variant="secondary" disabled={busy} onClick={onForgetBrowser}>Deixar de reconhecer este navegador</ActionButton></InformationCard>
    </CardGrid>
  </section>
}
