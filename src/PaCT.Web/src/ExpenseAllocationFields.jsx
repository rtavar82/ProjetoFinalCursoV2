import { useCallback, useState } from 'react'
import ActionButton from './ActionButton'
import AdaptiveSelect from './AdaptiveSelect'
import InformationCard from './InformationCard'
import Pagination from './Pagination'
import SearchInput from './SearchInput'
import { agendaDate, agendaMoney } from './agendaTime'
import { cents } from './financialSales'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'

export default function ExpenseAllocationFields({ allocations, total, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(null)
  const [kind, setKind] = useState('Consultation')
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const query = new URLSearchParams({ kind, term: search, page }).toString()
  const read = useCallback(signal => apiRequest('finance/expenses/activities?' + query, undefined, { signal }), [query])
  const activities = useLiveResource('consultations', 'expense-activities:' + query, read, open)
  const locations = activities.data?.locations || []
  const general = (cents(total) - allocations.reduce((sum, allocation) => sum + cents(allocation.amount), 0)) / 100
  function edit(key, change) {
    onChange(allocations.map(allocation => allocation.key === key ? { ...allocation, ...change } : allocation))
  }
  function searchFor(value) {
    setSearch(value)
    setPage(1)
    if (value === search && page === 1) activities.refresh()
  }
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Repartir a linha (opcional)</summary>
    <p>Associa valores a uma atividade, a um local ou a ambos. O restante fica como despesa geral.</p>
    {allocations.map((allocation, index) => <InformationCard key={allocation.key} cardId={'expense-allocation-' + allocation.key}
      title={'Repartição ' + (index + 1)} headingLevel={5}>
      <div className="fields-grid">
        <label>Valor a atribuir<input type="number" inputMode="decimal" step="any" value={allocation.amount}
          onChange={event => edit(allocation.key, { amount: event.target.value })} disabled={disabled} /></label>
        <label>Local<AdaptiveSelect aria-label="Local" value={allocation.location || ''} disabled={disabled}
          onChange={event => edit(allocation.key, { location: event.target.value || null })}>
          <option value="">Sem local específico</option>
          {[...new Set([...locations, allocation.location].filter(Boolean))].map(location => <option key={location} value={location}>{location}</option>)}
        </AdaptiveSelect></label>
      </div>
      {allocation.activity && <p>{allocation.activity.title} · {agendaDate(allocation.activity.startsAt)}</p>}
      <div className="button-row">
        <ActionButton variant="secondary" disabled={disabled} onClick={() => setPicking(picking === allocation.key ? null : allocation.key)}>
          {picking === allocation.key ? 'Fechar pesquisa de atividades' : allocation.activity ? 'Alterar atividade' : 'Escolher atividade'}
        </ActionButton>
        {allocation.activity && <ActionButton variant="text" disabled={disabled} onClick={() => edit(allocation.key, { activity: null })}>Retirar atividade</ActionButton>}
        <ActionButton variant="text" disabled={disabled} onClick={() => {
          if (picking === allocation.key) setPicking(null)
          onChange(allocations.filter(value => value.key !== allocation.key))
        }}>Retirar repartição</ActionButton>
      </div>
      {picking === allocation.key && <InformationCard title="Pesquisar atividades" headingLevel={6} cardId="expense-activity-picker">
        <div className="fields-grid">
          <label>Tipo de atividade<AdaptiveSelect aria-label="Tipo de atividade" value={kind} disabled={disabled} onChange={event => { setKind(event.target.value); setPage(1) }}>
            <option value="Consultation">Consultas</option><option value="Event">Grupos, oficinas e retiros</option>
          </AdaptiveSelect></label>
          <label>Nome da atividade ou local<SearchInput value={term} maxLength="200" showClear={!!(term || search)} disabled={disabled}
            onChange={event => setTerm(event.target.value)} onClear={() => { setTerm(''); searchFor('') }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); searchFor(term.trim()) } }} /></label>
        </div>
        <ActionButton variant="secondary" disabled={disabled} onClick={() => searchFor(term.trim())}>Pesquisar atividades</ActionButton>
        {activities.loading && <p role="status">A carregar atividades…</p>}
        {activities.data?.total === 0 && <p>Não foram encontradas atividades.</p>}
        {activities.data?.items.map(activity => <p key={activity.id}>
          <ActionButton variant="text" disabled={disabled} onClick={() => {
            edit(allocation.key, { activity, location: allocation.location || (locations.includes(activity.location) ? activity.location : null) })
            setPicking(null)
          }}>{activity.title} · {agendaDate(activity.startsAt)}{activity.location && ' · ' + activity.location}</ActionButton>
        </p>)}
        <Pagination total={activities.data?.total} pageSize={activities.data?.pageSize} page={page} onChange={setPage}
          disabled={disabled} label="Páginas das atividades" />
      </InformationCard>}
    </InformationCard>)}
    {activities.error && <InformationCard cardId="expense-activity-error" error={activities.error} onRetry={activities.refresh} />}
    <ActionButton variant="secondary" disabled={disabled || allocations.length >= 20} onClick={() =>
      onChange([...allocations, { key: crypto.randomUUID(), activity: null, location: null, amount: '' }])}>Acrescentar repartição</ActionButton>
    {allocations.length > 0 && (general >= 0 ? <p>Despesa geral: <strong>{agendaMoney(general)}</strong></p>
      : <p className="notice error" role="alert">A repartição excede o total da linha com IVA.</p>)}
  </details>
}
