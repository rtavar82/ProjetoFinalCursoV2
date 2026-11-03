import AdaptiveSelect from './AdaptiveSelect'
import { useCallback, useId, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import Heading from './Heading'
import Pagination from './Pagination'
import styles from './ClientSearch.module.css'

export default function ClientSearch({ selected, onSelect, disabled, readOnly = false, unavailableIds = [], purpose = 'booking', ariaLabel, canSelect }) {
  const filtering = purpose === 'filter'
  const booking = purpose === 'booking'
  const inputId = useId(), searchInput = useRef(null), formValue = useRef(null)
  const [field, setField] = useState('Name'), [term, setTerm] = useState(''), [query, setQuery] = useState(null), [page, setPage] = useState(1)
  const key = query ? new URLSearchParams({ ...query, page }).toString() : ''
  const read = useCallback(signal => apiRequest('clients?' + key, undefined, { signal }), [key])
  const people = useLiveResource('clients', 'client-search:' + key, read, !!query && !selected && !readOnly)
  function search() { if (!disabled && term.trim().length >= 3) { setPage(1); setQuery({ field, term: term.trim() }) } }
  function clearSearch() { setTerm(''); setQuery(null); setPage(1); searchInput.current?.focus() }
  function choose(person) {
    onSelect(person)
    // Keep the existing form change/temporary recovery tracking for selections
    // made with buttons, just as with the native financial client selector.
    formValue.current?.dispatchEvent(new Event('change', { bubbles: true }))
  }
  return <section className={`ui-card ${styles.search} ${!booking ? styles.compact : ''}`} aria-label={ariaLabel || (filtering ? 'Cliente da pesquisa' : booking ? 'Cliente da marcação' : 'Cliente da operação financeira')}><Heading level={3}>Cliente</Heading>
    {filtering && <input type="hidden" name="personId" value={selected?.id || ''} />}
    {purpose === 'finance' && <select hidden aria-hidden="true" tabIndex={-1} ref={formValue} name="personId" value={selected?.id || ''} onChange={() => {}}><option value="" />{selected && <option value={selected.id} />}</select>}
    {selected ? <><strong>{[selected.data.firstName, selected.data.lastName].filter(Boolean).join(' ')}</strong>{booking && <p className={styles.help}>A marcação fica ligada a esta ficha, com ou sem conta de acesso.</p>}{!readOnly && <button type="button" className="text-button" disabled={disabled} onClick={() => choose(null)}>{filtering ? 'Retirar cliente da pesquisa' : 'Escolher outra ficha'}</button>}</> : !readOnly && <>
      <div className={styles.searchFields}>
      <label>Pesquisar por<AdaptiveSelect aria-label="Pesquisar por" value={field} disabled={disabled} onChange={event => setField(event.target.value)}><option value="Name">Nome</option><option value="Phone">Telefone</option><option value="Email">Email</option></AdaptiveSelect></label>
      <div className={styles.searchTerm}><label htmlFor={inputId}>Pesquisa de clientes</label><div className={styles.searchInput}><input id={inputId} ref={searchInput} value={term} maxLength="254" disabled={disabled} onChange={event => setTerm(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); search() } }} />{(term || query) && <button type="button" className={styles.clearSearch} aria-label="Limpar pesquisa de clientes" title="Limpar pesquisa de clientes" disabled={disabled} onClick={clearSearch}>×</button>}</div></div>
      <button type="button" className="secondary" disabled={disabled || term.trim().length < 3} onClick={search}>Pesquisar fichas</button>
      </div>
      <p className={styles.help}>{filtering ? 'Sem cliente escolhido, a pesquisa inclui todos.' : 'Confirma a identidade antes de escolher a ficha; um contacto coincidente não é suficiente.'}</p>
      {people.loading && <p role="status">A pesquisar fichas…</p>}{people.error && <p role="alert" className="notice error">{people.error}</p>}
      {query && people.data && <div className={styles.people}>{people.data.items.map(person => <article key={person.id} className={styles.person}><div className={styles.personInfo}><strong>{[person.data.firstName, person.data.lastName].filter(Boolean).join(' ')}</strong><span>{[person.data.locality, person.data.phone ? `+${person.data.dialCode || ''} ${person.data.phone}` : '', person.data.email].filter(Boolean).join(' · ')}</span></div><button type="button" className="secondary" aria-label="Escolher esta ficha" title="Escolher esta ficha" disabled={disabled || unavailableIds.includes(person.id) || canSelect && !canSelect(person)} onClick={() => choose(person)}><span className={styles.chooseLabel}>Escolher esta ficha</span><span className={styles.chooseIcon} aria-hidden="true">›</span></button></article>)}
        {people.data.total === 0 && <p>{booking ? 'Não foram encontradas fichas. Podes criar primeiro a ficha em Clientes.' : 'Não foram encontradas fichas.'}</p>}
        <Pagination total={people.data.total} page={page} label="Páginas da pesquisa de fichas" disabled={disabled} onChange={setPage} />
      </div>}
    </>}
  </section>
}
