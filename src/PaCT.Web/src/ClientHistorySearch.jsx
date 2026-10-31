import AdaptiveSelect from './AdaptiveSelect'
import { useState } from 'react'
import AppIcon from './AppIcon'
import { addDays, instant } from './agendaTime'
import styles from './ClientAgenda.module.css'

const empty = { from: '', to: '', serviceId: '' }

export default function ClientHistorySearch({ services = [], onSearch }) {
  const [values, setValues] = useState(empty), [error, setError] = useState('')
  function change(event) { setValues(current => ({ ...current, [event.target.name]: event.target.value })); setError('') }
  function submit(event) {
    event.preventDefault()
    if (values.from && values.to && values.from > values.to) { setError('A data final deve ser igual ou posterior à data inicial.'); return }
    try {
      const query = new URLSearchParams({ search: 'true' })
      if (values.serviceId) query.set('serviceId', values.serviceId)
      if (values.from) query.set('from', instant(values.from + 'T00:00'))
      if (values.to) query.set('to', instant(addDays(values.to, 1) + 'T00:00'))
      setError(''); onSearch(query.toString())
    } catch (failure) { setError(failure.message) }
  }
  return <details className={`${styles.filters} ${styles.historySearch}`}>
    <summary><div><h2>Pesquisar nos teus registos</h2><p>Inclui todos os teus pedidos, marcações e consultas, de qualquer separador, incluindo grupos, oficinas e retiros.</p></div><AppIcon name="arrowDown" /></summary>
    <form aria-label="Pesquisa no histórico" onSubmit={submit}>
    <label>Tipo de consulta<AdaptiveSelect name="serviceId" value={values.serviceId} onChange={change}><option value="">Todos os tipos</option>{services.map(service => <option key={service.id} value={service.id}>{service.title}</option>)}</AdaptiveSelect></label>
    <div className={styles.historyDates}>
      <label>Desde<input name="from" type="date" value={values.from} onChange={change} /></label>
      <label>Até<input name="to" type="date" value={values.to} onChange={change} /></label>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className={styles.tabs}><button type="submit">Pesquisar</button><button type="button" className="secondary" onClick={() => { setValues(empty); setError(''); onSearch('') }}>Limpar pesquisa</button></div>
    </form>
  </details>
}
