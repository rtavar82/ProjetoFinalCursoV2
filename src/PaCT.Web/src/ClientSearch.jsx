import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import InformationCard from './InformationCard'
import SummaryCard from './SummaryCard'
import ActionButton from './ActionButton'
import SearchInput from './SearchInput'
import Pagination from './Pagination'
import { clientAccountStateLabel } from './clientLabels'
import styles from './ClientSearch.module.css'

export default function ClientSearch({ selected, onSelect, disabled, readOnly = false, unavailableIds = [], purpose = 'booking', ariaLabel, canSelect, enabled = true, children }) {
  const filtering = purpose === 'filter', directory = purpose === 'directory'
  const booking = purpose === 'booking', audit = purpose === 'audit'
  const permissions = purpose === 'permissions'
  const inputId = useId(), searchInput = useRef(null), formValue = useRef(null)
  const [term, setTerm] = useState(''), [query, setQuery] = useState(() => directory ? { term: '' } : null), [page, setPage] = useState(1)
  const key = query ? new URLSearchParams({ ...query, page }).toString() : ''
  const read = useCallback(signal => apiRequest('clients?' + key, undefined, { signal }), [key])
  const people = useLiveResource('clients', 'client-search:' + key, read, enabled && !!query && !selected && !readOnly)
  useEffect(() => {
    if (!people.data || people.error || page <= Math.max(1, Math.ceil(people.data.total / 8))) return
    const timer = window.setTimeout(() => setPage(Math.max(1, Math.ceil(people.data.total / 8))), 0)
    return () => window.clearTimeout(timer)
  }, [people.data, people.error, page])
  function applySearch(value) {
    if (disabled || !enabled) return
    if (permissions && selected) onSelect(null)
    if (query?.term === value && page === 1) people.refresh()
    setPage(1); setQuery({ term: value })
  }
  function search() { if (term.trim().length >= 3) applySearch(term.trim()) }
  function clearSearch() { setTerm(''); setQuery(null); setPage(1); searchInput.current?.focus() }
  function choose(person) {
    if (permissions) clearSearch()
    onSelect(person)
    // Selection belongs to the containing operation, not to the search results.
    if (!directory) formValue.current?.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const actionLabel = directory ? 'Abrir ficha' : 'Escolher esta ficha'
  const selectedName = selected && [selected.data.firstName, selected.data.lastName].filter(Boolean).join(' ')
  return <InformationCard className={`${styles.search} ${!booking && !directory ? styles.compact : ''} ${permissions ? styles.permissions : ''}`} title={directory ? 'Pesquisar clientes' : 'Cliente'} headingLevel={directory || permissions ? 2 : 3}
    aria-label={ariaLabel || (directory ? 'Pesquisa de clientes' : filtering ? 'Cliente da pesquisa' : booking ? 'Cliente da marcação' : 'Cliente da operação financeira')}>
    <div className={styles.content}>
    {filtering && <input type="hidden" name="personId" value={selected?.id || ''} />}
    {purpose === 'finance' && <select hidden aria-hidden="true" tabIndex={-1} ref={formValue} name="personId" value={selected?.id || ''} onChange={() => {}}><option value="" />{selected && <option value={selected.id} />}</select>}
    {selected && !permissions ? <><strong>{selectedName}</strong>{booking && <p className={styles.help}>A marcação fica ligada a esta ficha, com ou sem conta de acesso.</p>}{!readOnly && <ActionButton variant="text" disabled={disabled} onClick={() => { clearSearch(); choose(null) }}>{filtering ? 'Retirar cliente da pesquisa' : 'Escolher outra ficha'}</ActionButton>}</> : !readOnly && <>
      {directory && <p>Pesquisa nas fichas existentes, com ou sem conta registada.</p>}
      <div className={styles.searchFields}>
        <div className={styles.searchTerm}><label htmlFor={inputId}>Pesquisa de clientes</label><SearchInput id={inputId} ref={searchInput} value={term} maxLength="256" placeholder="Nome, email ou telefone" disabled={disabled} showClear={!!(term || query)} clearLabel="Limpar pesquisa de clientes" onClear={clearSearch} onChange={event => setTerm(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); search() } }} /></div>
        <ActionButton variant="secondary" disabled={disabled || term.trim().length < 3} onClick={search}>{directory ? 'Pesquisar' : 'Pesquisar fichas'}</ActionButton>
      </div>
      <p className={styles.help}>Indica pelo menos três caracteres. Podes escrever parte do nome, email ou telefone.</p>
      {directory ? <ActionButton variant="secondary" disabled={disabled} onClick={() => { setTerm(''); applySearch('') }}>Ver todas as fichas</ActionButton>
        : <p className={styles.help}>{permissions ? 'Escolhe uma ficha com conta para gerir a autorização.' : audit ? 'Escolhe uma ficha com uma conta de acesso ativa.' : filtering
          ? 'Sem cliente escolhido, a pesquisa inclui todos.' : 'Confirma a identidade antes de escolher a ficha; um contacto coincidente não é suficiente.'}</p>}
      {people.loading && <p role="status">A pesquisar fichas…</p>}{people.error && <div role="alert" className="notice error"><p>{people.error}</p><ActionButton variant="secondary" disabled={disabled} onClick={people.refresh}>Voltar a tentar</ActionButton></div>}
      {query && people.data && <>
        {directory && <SummaryCard cardId="client-count" label={people.data.total === 1 ? 'Ficha encontrada' : 'Fichas encontradas'} value={people.data.total} unit="registos" icon="people" />}
        <div className={styles.people}>{people.data.items.map(person => <article key={person.id} className={styles.person} data-client-id={person.id}><div className={styles.personInfo}>
          <strong>{[person.data.firstName, person.data.lastName].filter(Boolean).join(' ')}</strong>
          <span>{[person.data.locality, person.data.phone ? `+${person.data.dialCode || ''} ${person.data.phone}` : '', person.data.email,
            (directory || audit || permissions) && (person.hasAccount ? 'Com conta · ' + clientAccountStateLabel(person.accountState) : 'Ficha sem conta'),
            directory && person.identityReviewStatus === 'Pending' && 'Identidade por verificar'].filter(Boolean).join(' · ')}</span>
        </div><ActionButton variant="secondary" aria-label={actionLabel} title={actionLabel} disabled={disabled || unavailableIds.includes(person.id) || canSelect && !canSelect(person)} onClick={() => choose(person)}><span className={styles.chooseLabel}>{actionLabel}</span><span className={styles.chooseIcon} aria-hidden="true">›</span></ActionButton></article>)}</div>
        {people.data.total === 0 && <p>{booking ? 'Não foram encontradas fichas. Podes criar primeiro a ficha em Clientes.' : 'Não foram encontradas fichas.'}</p>}
        <Pagination total={people.data.total} page={page} label="Páginas da pesquisa de fichas" disabled={disabled} showTotal={directory} onChange={setPage} />
      </>}
    </>}
    {selected && permissions && <div className={styles.permissionSelection}>
      <strong>{selectedName}</strong>
      {children}
    </div>}
    </div>
  </InformationCard>
}
