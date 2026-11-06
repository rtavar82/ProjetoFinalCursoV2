import ActionButton from './ActionButton'
import AdaptiveSelect from './AdaptiveSelect'
import InformationCard from './InformationCard'
import Pagination from './Pagination'
import SearchInput from './SearchInput'
import { agendaDate } from './agendaTime'

export default function ExpenseActivitySearch({ lookup, disabled, onSelect, headingLevel = 5 }) {
  const { kind, changeKind, term, setTerm, search, searchFor, data, page, setPage, loading, error, refresh } = lookup
  return <InformationCard title="Pesquisar atividades" headingLevel={headingLevel} cardId="expense-activity-picker"
    loading={loading} error={error} onRetry={refresh}>
    <div className="fields-grid">
      <label>Tipo de atividade<AdaptiveSelect aria-label="Tipo de atividade" value={kind} disabled={disabled} onChange={event => changeKind(event.target.value)}>
        <option value="Consultation">Consultas</option><option value="Event">Grupos, oficinas e retiros</option>
      </AdaptiveSelect></label>
      <label>Nome da atividade ou local<SearchInput value={term} maxLength="200" showClear={!!(term || search)} disabled={disabled}
        onChange={event => setTerm(event.target.value)} onClear={() => { setTerm(''); searchFor('') }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); searchFor(term.trim()) } }} /></label>
    </div>
    <ActionButton variant="secondary" disabled={disabled} onClick={() => searchFor(term.trim())}>Pesquisar atividades</ActionButton>
    {data?.total === 0 && <p>Não foram encontradas atividades.</p>}
    {data?.items.map(activity => <p key={activity.id}>
      <ActionButton variant="text" disabled={disabled || !!error || lookup.refreshing} onClick={() => onSelect(activity)}>
        {activity.title} · {agendaDate(activity.startsAt)}{activity.location && ' · ' + activity.location}
      </ActionButton>
    </p>)}
    <Pagination total={data?.total} pageSize={data?.pageSize} page={page} onChange={setPage} disabled={disabled} label="Páginas das atividades" />
  </InformationCard>
}
