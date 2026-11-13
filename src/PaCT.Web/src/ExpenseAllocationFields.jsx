import moneyText from './moneyText'
import DisclosureSummary from './DisclosureSummary'
import { useState } from 'react'
import ActionButton from './ActionButton'
import AdaptiveSelect from './AdaptiveSelect'
import InformationCard from './InformationCard'
import ExpenseActivitySearch from './ExpenseActivitySearch'
import { agendaDate, agendaMoney } from './agendaTime'
import { cents } from './financialSales'
import useExpenseActivitySearch from './useExpenseActivitySearch'

export default function ExpenseAllocationFields({ allocations, total, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(null)
  const activities = useExpenseActivitySearch(open)
  const locations = activities.data?.locations || []
  const general = (cents(total) - allocations.reduce((sum, allocation) => sum + cents(allocation.amount), 0)) / 100
  function edit(key, change) {
    onChange(allocations.map(allocation => allocation.key === key ? { ...allocation, ...change } : allocation))
  }
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <DisclosureSummary>Repartir a linha (opcional)</DisclosureSummary>
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
      {picking === allocation.key && <ExpenseActivitySearch lookup={activities} headingLevel={6} disabled={disabled} onSelect={activity => {
        edit(allocation.key, { activity, location: allocation.location || (locations.includes(activity.location) ? activity.location : null) })
        setPicking(null)
      }} />}
    </InformationCard>)}
    {activities.error && picking === null && <InformationCard cardId="expense-activity-error" error={activities.error} onRetry={activities.refresh} />}
    <ActionButton variant="secondary" disabled={disabled || allocations.length >= 20} onClick={() =>
      onChange([...allocations, { key: crypto.randomUUID(), activity: null, location: null, amount: '' }])}>Acrescentar repartição</ActionButton>
    {allocations.length > 0 && (general >= 0 ? <p>Despesa geral: <strong>{moneyText(agendaMoney(general))}</strong></p>
      : <p className="notice error" role="alert">A repartição excede o total da linha com IVA.</p>)}
  </details>
}
