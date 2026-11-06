import { useState } from 'react'
import { apiRequest } from './identityApi'
import { dismissSuccess, showSuccess, showWarning } from './actionNotices'
import { usePrivacy } from './privacyContext'

async function bounded(promise, message, milliseconds = 15000) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), milliseconds) })]) }
  finally { window.clearTimeout(timer) }
}

async function activeRegistration() {
  const failure = 'Não foi possível preparar as notificações. Verifica se o navegador reconhece a ligação HTTPS deste site como segura e volta a tentar.'
  return bounded((async () => {
    const existing = await navigator.serviceWorker.getRegistration('/')
    if (existing?.active) return existing
    await navigator.serviceWorker.register('/service-worker.js', { scope: '/', updateViaCache: 'none' })
    return navigator.serviceWorker.ready
  })().catch(() => { throw new Error(failure) }), failure)
}

export default function PushConsent({ label = 'Ativar notificações neste dispositivo', primary = false, disabled = false }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const privacy = usePrivacy()
  const needsConsent = privacy?.client && privacy.policy && (!privacy.push?.accepted || !!privacy.choices.error)
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  async function enable() {
    if (busy || disabled || !supported || !navigator.onLine) return
    dismissSuccess(); setBusy(true); setMessage('')
    try {
      if (await Notification.requestPermission() !== 'granted') throw new Error('As notificações não foram autorizadas. Os avisos continuam disponíveis na aplicação.')
      const registration = await activeRegistration()
      const { publicKey } = await apiRequest('push/key')
      const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
      const subscription = await bounded((async () => await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes }))(), 'O serviço de notificações do equipamento não respondeu. Verifica a ligação e volta a tentar.')
      const result = await apiRequest('push/subscribe', subscription.toJSON())
      if (result.enabled !== true) throw new Error('Não foi possível confirmar a ativação das notificações. Volta a tentar.')
      showSuccess('Notificações ativadas neste equipamento.')
    } catch (failure) { setMessage(failure.message || 'Não foi possível ativar as notificações neste dispositivo.'); showWarning('Não foi possível ativar as notificações. Consulta a indicação junto do botão.') }
    finally { setBusy(false) }
  }
  return <div className="account-actions">{(supported || primary) && <button className={primary ? '' : 'secondary'} type="button" disabled={disabled || busy || !navigator.onLine || !supported || needsConsent} onClick={enable}>{busy ? 'A ativar…' : label}</button>}{needsConsent && <p>Autoriza primeiro as notificações na secção de privacidade.</p>}{!supported && <p>Este navegador não permite notificações no dispositivo. Os avisos continuam na aplicação.</p>}{message && <p role="status">{message}</p>}</div>
}
