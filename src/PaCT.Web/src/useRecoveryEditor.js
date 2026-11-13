import { useCallback, useState } from 'react'
import useRecoveryState from './useRecoveryState'
import useLiveResource from './useLiveResource'
import { apiRequest } from './identityApi'

// Reopen an editor using only its record identifier and explicit UI flags.
export default function useRecoveryEditor(scope, endpoint, resource, property, flags = []) {
  const [entry, remember] = useRecoveryState('view:editor:' + scope, null)
  const [local, setLocal] = useState(null)
  const recordId = entry?.id
  const read = useCallback(signal => apiRequest(endpoint + recordId, undefined, { signal }), [endpoint, recordId])
  const result = useLiveResource(resource, 'editor:' + scope + ':' + entry?.id, read, !!entry?.id)
  const flagNames = flags.join('|')
  const change = useCallback(value => {
    const metadata = value ? { id: value[property]?.id || null, flags: Object.fromEntries(flagNames.split('|').filter(Boolean).map(name => [name, value[name]])) } : null
    setLocal(value ? { scope, metadata, value } : null); remember(metadata)
  }, [scope, property, flagNames, remember])
  if (!entry) return [null, change]
  if (local?.scope === scope && JSON.stringify(local.metadata) === JSON.stringify(entry)) return [local.value, change]
  const record = entry.id ? result.data?.[property] : null
  return [entry.id && !record ? null : { ...entry.flags, [property]: record }, change]
}
