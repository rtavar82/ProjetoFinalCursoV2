import { useCallback, useContext, useEffect, useState } from 'react'
import { invalidateResources, observeResource, readInFlight, resourceRevision } from './liveUpdates'
import { LiveResourceContext } from './liveResourceContext'
import { reportStaleContent, unavailableRead } from './readFreshness'

// Keep the last confirmed read mounted during revalidation. Editable state must
// live separately: a newer snapshot never hydrates or changes the key of a form.
export default function useLiveResource(resource, key, read, enabled = true) {
  const [snapshot, setSnapshot] = useState(null)
  const sessionReads = useContext(LiveResourceContext)
  const [localReads] = useState(() => new Map())
  const reads = sessionReads || localReads
  useEffect(() => {
    if (!enabled) return
    let current = true
    async function load() {
      const revision = resourceRevision(resource)
      setSnapshot(previous => previous?.key === key ? { ...previous, refreshing: true } : { key, data: null, error: '', refreshing: true })
      try {
        const data = await readInFlight(reads, resource, key, revision, read)
        if (current && resourceRevision(resource) === revision) setSnapshot({ key, data, error: '', refreshing: false })
      } catch (failure) {
        if (current && unavailableRead(failure)) reportStaleContent()
        if (current && resourceRevision(resource) === revision) setSnapshot(previous => ({ key, data: previous?.key === key ? previous.data : null, error: failure.message, refreshing: false }))
      }
    }
    const stop = observeResource(resource, load)
    // Navigation invalidates the consumer, not a request already executing on
    // the server. Its result can only reach consumers still in the same scope.
    return () => { current = false; stop() }
  }, [resource, key, read, enabled, reads])
  const refresh = useCallback(() => invalidateResources([resource]), [resource])
  const value = snapshot?.key === key ? snapshot : null
  return { data: value?.data ?? null, error: value?.error ?? '', loading: enabled && !value?.data && !value?.error, refreshing: value?.refreshing ?? false, refresh }
}
