import { useCallback } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'

// Load options only for an open form/filter, never for ordinary list navigation.
export default function useClientOptions(enabled) {
  const read = useCallback(async () => {
    const all = []; let next = 1; let total
    do {
      const batch = await apiRequest(`clients?field=Name&page=${next++}`)
      total = batch.total; all.push(...batch.items)
      if (!batch.items.length) break
    } while (all.length < total && next <= 100)
    const name = person => [person.data.firstName, person.data.lastName].filter(Boolean).join(' ')
    return all.sort((a, b) => name(a).localeCompare(name(b), 'pt-PT'))
  }, [])
  return useLiveResource('clients', 'consultation-customer-options', read, enabled)
}
