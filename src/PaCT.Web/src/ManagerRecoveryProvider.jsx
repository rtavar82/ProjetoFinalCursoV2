import { useEffect, useRef, useState } from 'react'
import { ManagerRecoveryContext } from './managerRecoveryContext'
import { createManagerRecovery } from './managerRecoveryRuntime'
import { isManager } from './identityRoles'
import { checkpointRecord, dropRecoveryTicket, readRecoveryTicket } from './managerRecoveryStorage'

export default function ManagerRecoveryProvider({ profile, children }) {
  return isManager(profile.role) ? <ProtectedWorkspace key={profile.id} profile={profile}>{children}</ProtectedWorkspace> : <OrdinaryWorkspace>{children}</OrdinaryWorkspace>
}
function OrdinaryWorkspace({ children }) {
  useEffect(() => {
    const ticket = readRecoveryTicket()
    if (ticket) { dropRecoveryTicket(); void checkpointRecord(ticket.id, null).catch(() => {}) }
  }, [])
  return children
}
function ProtectedWorkspace({ profile, children }) {
  const pending = useRef(null)
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    pending.current ??= createManagerRecovery(profile, setError)
    pending.current.then(runtime => { if (current) setState({ runtime }) }).catch(() => {
      if (current) { setError('Não foi possível preparar a recuperação temporária. Podes continuar, mas mantém os formulários abertos.'); setState({ runtime: null }) }
    })
    return () => { current = false }
  }, [profile])
  useEffect(() => state?.runtime?.start(), [state])
  useEffect(() => {
    function expired() { state?.runtime?.discard() }
    window.addEventListener('pact:session-expired', expired)
    return () => window.removeEventListener('pact:session-expired', expired)
  }, [state])
  if (!state) return <p role="status">A preparar a tua área…</p>
  return <ManagerRecoveryContext.Provider value={state.runtime}>{error && <p className="notice error" role="alert">{error}</p>}{children}</ManagerRecoveryContext.Provider>
}
