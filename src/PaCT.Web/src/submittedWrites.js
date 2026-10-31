import { reportStaleContent } from './readFreshness.js'

// A submitted operation lives only in this open window. Never persist passwords,
// commands or files, and never repeat an uncertain write without replay protection.
const pending = new Set()
const cancelled = () => new Error('O envio pendente foi cancelado. O preenchimento não foi enviado.')
export function cancelSubmittedWrites() { for (const cancel of [...pending]) cancel() }

export function waitForConnection(isCurrent = () => true) {
  return new Promise((resolve, reject) => {
    let timer, delay = 1000, checking = false
    function stop() {
      clearTimeout(timer); pending.delete(cancel)
      window.removeEventListener('online', check)
      window.removeEventListener('focus', check)
      window.removeEventListener('pagehide', cancel)
      window.removeEventListener('pact:session-expired', cancel)
    }
    function cancel() { stop(); reject(cancelled()) }
    async function check() {
      clearTimeout(timer)
      if (!isCurrent()) { cancel(); return }
      if (checking) return
      checking = true
      try {
        if (navigator.onLine) {
          const response = await fetch('/api/identity/installation', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(5000) })
          if (response.ok) { stop(); resolve(); return }
        }
      } catch { /* Keep this already-submitted operation in memory until the connection returns. */ }
      finally { checking = false }
      if (!pending.has(cancel)) return
      timer = setTimeout(check, delay); delay = Math.min(delay * 2, 15000)
    }
    pending.add(cancel)
    window.addEventListener('online', check)
    window.addEventListener('focus', check)
    window.addEventListener('pagehide', cancel)
    window.addEventListener('pact:session-expired', cancel)
    timer = setTimeout(check, delay)
  })
}

export async function submittedWrite(attempt, replaySafe = false) {
  for (;;) {
    if (!navigator.onLine) { reportStaleContent(); await waitForConnection() }
    let sent = false
    try { return await attempt(() => { sent = true }) }
    catch (error) {
      if (error.status && error.status < 500 || error.name === 'AbortError') throw error
      reportStaleContent()
      if (sent && !(typeof replaySafe === 'function' ? replaySafe() : replaySafe)) throw new Error('O envio ficou sem confirmação. O preenchimento foi mantido; é necessário verificar o resultado antes de repetir.', { cause: error })
      await waitForConnection()
    }
  }
}

export function clientOperation(path) {
  return /^(clients(?:\/[0-9a-f-]+(?:\/notes(?:\/[0-9a-f-]+)?)?|\/reviews\/[0-9a-f-]+)?|profile|identity\/client-registration)$/.test(path)
}

export function canReplay(path, body, operationKey) {
  return !!operationKey && clientOperation(path) || ['consultations/manual-preview', 'consultations/publication-preview'].includes(path) || !!body?.operationId && (path === 'consultations/commands' || path === 'consultations/guests'
    || /^consultations\/events\/[^/]+\/requests$/.test(path)
    || /^clients\/[^/]+\/access\/(email|reset-passkeys)$/.test(path)
    || path === 'identity/password-change')
}
