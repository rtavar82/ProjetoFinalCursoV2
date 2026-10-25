import { useState } from 'react'
import { apiRequest } from './identityApi'

export default function PushConsent() {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  async function enable() {
    setBusy(true)
    try {
      if (await Notification.requestPermission() !== 'granted') throw new Error('As notificações não foram autorizadas. Os avisos continuam disponíveis na aplicação.')
      const registration = await navigator.serviceWorker.ready
      const { publicKey } = await apiRequest('push/key')
      const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes })
      await apiRequest('push/subscribe', subscription.toJSON())
      setMessage('Notificações ativadas neste dispositivo.')
    } catch (failure) { setMessage(failure.message || 'Não foi possível ativar as notificações neste dispositivo.') }
    finally { setBusy(false) }
  }
  return <div className="account-actions">{supported ? <button className="secondary" type="button" disabled={busy || !navigator.onLine} onClick={enable}>{busy ? 'A ativar…' : 'Ativar notificações neste dispositivo'}</button> : <p>Este navegador não permite notificações no dispositivo. Os avisos continuam na aplicação.</p>}{message && <p role="status">{message}</p>}</div>
}
