import { useCallback, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'

export default function useExpenseActivitySearch(active = true) {
  const [kind, setKind] = useState('Consultation')
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const query = new URLSearchParams({ kind, term: search, page }).toString()
  const read = useCallback(signal => apiRequest('finance/expenses/activities?' + query, undefined, { signal }), [query])
  const resource = useLiveResource('consultations', 'expense-activities:' + query, read, active)
  function searchFor(value) {
    setSearch(value)
    setPage(1)
    if (value === search && page === 1) resource.refresh()
  }
  return { ...resource, kind, changeKind: value => { setKind(value); setPage(1) }, term, setTerm, search, searchFor, page, setPage }
}
