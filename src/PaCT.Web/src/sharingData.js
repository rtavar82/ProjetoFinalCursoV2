import { managerAccountHeaders, managerAccountIsCurrent } from './managerWriteRecovery'
import { apiRequest, SESSION_EXPIRED } from './identityApi'
import { invalidateResources } from './liveUpdates'
import { submittedWrite } from './submittedWrites'

export function readSharingTarget(reference, options) {
  return apiRequest('sharing/agenda?' + new URLSearchParams({ reference }), undefined, options)
}

export function uploadSharingPost(id, form) {
  const accountHeaders = managerAccountHeaders()
  return submittedWrite(async sent => {
    const csrf = await apiRequest('identity/csrf')
    sent()
    const response = await fetch('/api/sharing/' + id, {
      method: 'POST', body: form, credentials: 'same-origin', cache: 'no-store',
      headers: { ...accountHeaders, 'X-PaCT-CSRF': csrf.token }, signal: AbortSignal.timeout(120000),
    })
    if (response.status === 401 && managerAccountIsCurrent(accountHeaders)) window.dispatchEvent(new Event(SESSION_EXPIRED))
    const result = await response.json().catch(() => ({}))
    if (!response.ok || result.id !== id || result.confirmed !== true) {
      const error = new Error(result.title || 'Não foi possível confirmar a publicação. O preenchimento foi mantido.')
      error.status = response.status
      throw error
    }
    invalidateResources(['sharing'])
    return result
  })
}