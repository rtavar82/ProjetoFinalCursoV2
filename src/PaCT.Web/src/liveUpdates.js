export const REFRESH_INTERVAL_MS = 60000
const changeEvent = 'pact:resources-changed'
const revisions = new Map()
export function resourceRevision(resource) { return revisions.get(resource) || 0 }

// Only pending reads are shared. No response cache, persistence or cross-session
// state: the map belongs to the authenticated workspace and is discarded with it.
export function readInFlight(reads, resource, key, revision, read) {
  const identity = JSON.stringify([resource, key, revision])
  if (!reads.has(identity)) {
    const pending = Promise.resolve().then(read).finally(() => {
      if (reads.get(identity) === pending) reads.delete(identity)
    })
    reads.set(identity, pending)
  }
  return reads.get(identity)
}

export function invalidateResources(resources) {
  for (const resource of new Set(resources)) revisions.set(resource, resourceRevision(resource) + 1)
  window.dispatchEvent(new CustomEvent(changeEvent, { detail: { resources: [...new Set(resources)] } }))
}

export function announceSuccessfulWrite(path, body) {
  const endpoint = path.split('?')[0]
  const resources = []
  if (/^(clients(?:\/|$)|profile$|identity\/client-registration$)/.test(endpoint)) resources.push('clientReviews', 'clients', 'profile', 'clientAccess')
  if (endpoint === 'consultations/commands') {
    if (['SendMessage', 'ReadMessages', 'BlockConversation', 'ReopenConversation'].includes(body?.action)) resources.push('consultationNotices', 'consultations', 'consultationMessages')
    else resources.push('consultationNotices', 'consultations', 'finance', 'agenda', 'guestRequests', 'packs', 'events')
  }
  if (/^consultations\/events\/[^/]+\/requests$/.test(endpoint)) resources.push('events', 'consultationNotices')
  if (endpoint === 'consultations/guests') resources.push('agenda', 'consultationNotices', 'guestRequests')
  if (/^identity\/(passkeys|google|password-change)/.test(endpoint)) resources.push('accountSecurity')
  if (resources.length) invalidateResources(resources)
}

// Refresh readers only. Never hydrate, remount or submit an editing form here.
export function observeResource(resource, read) {
  let stopped = false
  let loading = false
  let queued = false
  async function refresh(force = false) {
    if (stopped || !navigator.onLine || document.visibilityState === 'hidden') return
    if (loading) { if (force === true) queued = true; return }
    loading = true
    try { await read() }
    finally {
      loading = false
      if (queued) { queued = false; if (!stopped) void refresh(true) }
    }
  }
  function changed(event) { if (event.detail?.resources?.includes(resource)) void refresh(true) }
  const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS)
  window.addEventListener(changeEvent, changed)
  window.addEventListener('focus', refresh)
  window.addEventListener('online', refresh)
  document.addEventListener('visibilitychange', refresh)
  // StrictMode can set up and remove an effect in the same turn. Do not send a
  // request for that discarded observer, or for a page already left behind.
  queueMicrotask(() => { void refresh() })
  return () => {
    stopped = true
    window.clearInterval(timer)
    window.removeEventListener(changeEvent, changed)
    window.removeEventListener('focus', refresh)
    window.removeEventListener('online', refresh)
    document.removeEventListener('visibilitychange', refresh)
  }
}
