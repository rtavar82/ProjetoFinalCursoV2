import { useCallback, useState } from 'react'
import useRecoveryState from './useRecoveryState'
import useLiveResource from './useLiveResource'
import { apiRequest } from './identityApi'

// Persist an identifier only. Every restored record is fetched with the current
// authenticated session before its editor or private content can be displayed.
export default function useRecoveryRecord(scope, endpoint, resource, summary = false) {
  const [id, remember] = useRecoveryState('view:record:' + scope, null)
  const [local, setLocal] = useState(null)
  const read = useCallback(signal => apiRequest(endpoint + id, undefined, { signal }), [endpoint, id])
  const result = useLiveResource(resource, 'recovery:' + scope + ':' + id, read, !!id)
  const change = useCallback(value => { setLocal({ scope, value }); remember(value ? summary ? value.summary.id : value.id : null) }, [remember, summary, scope])
  const localValue = local?.scope === scope ? local.value : null
  const localId = localValue && (summary ? localValue.summary.id : localValue.id)
  return [localId && localId === id ? localValue : result.data, change, result]
}
