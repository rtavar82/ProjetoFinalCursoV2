export const STALE_CONTENT = 'pact:stale-content'
let unavailable = false

export function reportStaleContent() {
  unavailable = true
  window.dispatchEvent(new Event(STALE_CONTENT))
}

export function reportFreshContent() { unavailable = false }
export function contentUnavailable() { return unavailable || !navigator.onLine }

export function unavailableRead(error) {
  return error?.name !== 'AbortError' && (!error?.status || error.status >= 500)
}
