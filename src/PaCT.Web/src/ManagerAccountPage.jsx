import { useState } from 'react'
import AccountSecuritySettings from './AccountSecuritySettings'
import ActionButton from './ActionButton'
import AgendaPresentation from './AgendaPresentation'
import MenuDetailLayout from './MenuDetailLayout'
import PasskeySettings from './PasskeySettings'
import PushConsent from './PushConsent'
import TherapistManagement from './TherapistManagement'
import { isManager } from './identityRoles'

const areas = [
  { id: 'passkeys', label: 'Passkeys', description: 'Proteção da entrada' },
  { id: 'password', label: 'Palavra-passe', description: 'Alteração por email' },
  { id: 'google', label: 'Google', description: 'Entrada com conta Google' },
  { id: 'notifications', label: 'Notificações', description: 'Avisos neste equipamento' },
  { id: 'therapist', label: 'Gestora-terapeuta', description: 'Conta de acompanhamento' },
  { id: 'browser', label: 'Navegador', description: 'Reconhecimento deste dispositivo' },
]

export default function ManagerAccountPage({ profile, busy, perform, notify, guard, onPasskeyUpdated, onSecuritySignedOut, onForgetBrowser }) {
  const [area, setArea] = useState('passkeys')
  const items = areas.filter(item => item.id !== 'therapist' || isManager(profile.role))
  function changeArea(next) {
    if (next !== area) guard(() => setArea(next))
  }
  return <AgendaPresentation title="Meu perfil" headingId="my-profile-title" eyebrow="" description="" aria-label="Definições da conta">
    <MenuDetailLayout label="Áreas do meu perfil" selectorLabel="Mostrar opções do perfil" items={items} value={area}
      onChange={changeArea} disabled={busy} cardId={'manager-profile-' + area}
      status={area === 'passkeys' ? profile.passkeyEnabled ? 'Ativa' : 'Por registar' : undefined}>
      {area === 'passkeys' && <PasskeySettings inline enabled={profile.passkeyEnabled} required busy={busy} perform={perform} onUpdated={onPasskeyUpdated} notify={notify} />}
      {['password', 'google'].includes(area) && <AccountSecuritySettings key={area} view={area} initiallyOpen busy={busy} perform={perform} notify={notify} guard={guard} onSignedOut={onSecuritySignedOut} />}
      {area === 'notifications' && <PushConsent label="Activar notificações neste equipamento" primary disabled={busy} />}
      {area === 'therapist' && <TherapistManagement inline busy={busy} perform={perform} notify={notify} canManageAccess={profile.role === 'TechnicalManager'} />}
      {area === 'browser' && <ActionButton variant="secondary" disabled={busy} onClick={onForgetBrowser}>Deixar de reconhecer este navegador</ActionButton>}
    </MenuDetailLayout>
  </AgendaPresentation>
}
