import { useEffect, useState } from 'react'
import { openPrivateVault, PRIVATE_DRAFTS_CHANGED } from './privateDrafts'
import { PrivateDraftContext, usePrivateVault } from './privateDraftContext'
import { SESSION_EXPIRED } from './identityApi'

export default function PrivateDraftProvider({ owner, children }) {
  const [state, setState] = useState({ vault: null, error: '' })
  const [revision, retry] = useState(0)
  useEffect(() => {
    let active = true
    let opened
    function expired() { active = false; opened?.lock(); setState({ vault: null, error: 'A sessão terminou. Inicia sessão com ligação à internet para recuperar os rascunhos.' }) }
    window.addEventListener(SESSION_EXPIRED, expired)
    openPrivateVault(owner).then(vault => { opened = vault; if (active) setState({ vault, error: '' }); else vault.lock() })
      .catch(error => { if (active) setState({ vault: null, error: error.message }) })
    return () => { active = false; opened?.lock(); window.removeEventListener(SESSION_EXPIRED, expired) }
  }, [owner, revision])
  return <PrivateDraftContext.Provider value={{ ...state, retry: () => retry(n => n + 1) }}>{children}</PrivateDraftContext.Provider>
}

export function PrivateDraftStatus() {
  const session = usePrivateVault()
  return <>
    {session?.error && <div className="notice error" role="alert">Os rascunhos privados não estão disponíveis. {session.error}<button type="button" className="secondary" onClick={session.retry}>Voltar a desbloquear rascunhos</button></div>}
  </>
}

export function PrivateDraftRecovery({ onOpen }) {
  const session = usePrivateVault()
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!session?.vault) return
    let active = true
    const load = () => session.vault.list().then(rows => { if (active) { setItems(rows); setError('') } }).catch(failure => { if (active) setError(failure.message) })
    load(); window.addEventListener(PRIVATE_DRAFTS_CHANGED, load)
    return () => { active = false; window.removeEventListener(PRIVATE_DRAFTS_CHANGED, load) }
  }, [session?.vault])
  if (!session?.vault || (!items.length && !error)) return null
  return <details className="record-panel"><summary>Rascunhos privados neste aparelho ({items.length})</summary>
    {error && <p role="alert">{error}</p>}
    {items.map(item => <div key={item.scope}><p>{item.title} · Guardado neste aparelho</p><button type="button" className="secondary" onClick={() => onOpen(item)}>{item.kind === 'Testimonial' ? 'Retomar publicação' : item.kind === 'ClientBooking' ? 'Retomar pedido' : item.kind === 'ConsultationMessage' ? 'Retomar mensagem' : item.kind === 'ConsultationNote' ? 'Retomar nota' : item.kind === 'EventAttendance' ? 'Retomar presença' : 'Retomar rascunho de fecho'}</button></div>)}
  </details>
}
