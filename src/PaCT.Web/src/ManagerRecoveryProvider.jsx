import { useEffect, useState } from 'react'
import { ManagerRecoveryContext } from './managerRecoveryContext'
import { createManagerRecovery } from './managerRecoveryRuntime'
import { isManager } from './identityRoles'
import { showSuccess } from './actionNotices'

export default function ManagerRecoveryProvider({ profile, children }) {
  return isManager(profile.role) ? <ProtectedWorkspace key={profile.id} profile={profile}>{children}</ProtectedWorkspace> : children
}
function ProtectedWorkspace({ profile, children }) {
  const [error, setError] = useState('')
  const [runtime] = useState(() => createManagerRecovery(profile, setError, () => showSuccess('Preenchimento recuperado. Revê os dados antes de confirmar.')))
  useEffect(() => runtime.start(), [runtime])
  return <ManagerRecoveryContext.Provider value={runtime}>{error && <p className="notice error" role="alert">{error}</p>}{children}</ManagerRecoveryContext.Provider>
}
