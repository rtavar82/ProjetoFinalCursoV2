import { useCallback } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'

export default function useConsultationNames(items, detail, manager) {
  const key = manager ? [...new Set([...items.map(x => x.personId), detail?.personId].filter(Boolean))].sort().join(',') : ''
  const read = useCallback(async signal => {
    const ids = key.split(',')
    const batches = []
    for (let index = 0; index < ids.length; index += 8) {
      const query = new URLSearchParams(ids.slice(index, index + 8).map(id => ['ids', id]))
      batches.push(apiRequest('clients/names?' + query, undefined, { signal }))
    }
    return Object.assign({}, ...await Promise.all(batches))
  }, [key])
  return useLiveResource('clients', 'consultation-names:' + key, read, !!key)
}
