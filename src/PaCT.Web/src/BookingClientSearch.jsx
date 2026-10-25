import { useCallback, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import styles from './ManagerScheduling.module.css'

export default function BookingClientSearch({ selected, onSelect, disabled }) {
  const [field, setField] = useState('Name'), [term, setTerm] = useState(''), [query, setQuery] = useState(null), [page, setPage] = useState(1)
  const key = query ? new URLSearchParams({ ...query, page }).toString() : ''
  const read = useCallback(signal => apiRequest('clients?' + key, undefined, { signal }), [key])
  const people = useLiveResource('clients', 'manual-search:' + key, read, !!query && !selected)
  function search() { if (!disabled && term.trim().length >= 3) { setPage(1); setQuery({ field, term: term.trim() }) } }
  return <section className={styles.search} aria-label="Cliente da marcação"><h3>Cliente</h3>
    {selected ? <><strong>{[selected.data.firstName, selected.data.lastName].filter(Boolean).join(' ')}</strong><p className={styles.help}>A marcação fica ligada a esta ficha, com ou sem conta de acesso.</p><button type="button" className="text-button" disabled={disabled} onClick={() => onSelect(null)}>Escolher outra ficha</button></> : <>
      <label>Pesquisar por<select aria-label="Pesquisar por" value={field} disabled={disabled} onChange={event => setField(event.target.value)}><option value="Name">Nome</option><option value="Phone">Telefone</option><option value="Email">Email</option></select></label>
      <label>Pesquisa de clientes<input value={term} maxLength="254" disabled={disabled} onChange={event => setTerm(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); search() } }} /></label>
      <button type="button" className="secondary" disabled={disabled || term.trim().length < 3} onClick={search}>Pesquisar fichas</button>
      <p className={styles.help}>Confirma a identidade antes de escolher a ficha; um contacto coincidente não é suficiente.</p>
      {people.loading && <p role="status">A pesquisar fichas…</p>}{people.error && <p role="alert" className="notice error">{people.error}</p>}
      {people.data && <div className={styles.people}>{people.data.items.map(person => <article key={person.id} className={styles.person}><strong>{[person.data.firstName, person.data.lastName].filter(Boolean).join(' ')}</strong><p>{person.data.locality}{person.data.phone ? ` · +${person.data.dialCode || ''} ${person.data.phone}` : ''}{person.data.email ? ` · ${person.data.email}` : ''}</p><button type="button" className="secondary" disabled={disabled || person.isActive === false || person.identityReviewStatus === 'Pending'} onClick={() => onSelect(person)}>Escolher esta ficha</button></article>)}
        {people.data.total === 0 && <p>Não foram encontradas fichas. Podes criar primeiro a ficha em Clientes.</p>}
        {people.data.total > 8 && <nav className={styles.pager} aria-label="Páginas da pesquisa de fichas"><button type="button" className="secondary" disabled={disabled || page === 1} onClick={() => setPage(value => value - 1)}>Anterior</button><span>Página {page}</span><button type="button" className="secondary" disabled={disabled || page * 8 >= people.data.total} onClick={() => setPage(value => value + 1)}>Seguinte</button></nav>}
      </div>}
    </>}
  </section>
}
