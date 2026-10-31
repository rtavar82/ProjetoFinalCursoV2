import { useId, useState } from 'react'
import AppIcon from './AppIcon'
import styles from './AgendaFilters.module.css'

export default function AgendaFilters({ active, summary, onReset, children }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  return <section className={styles.card} aria-label="Filtros da agenda" data-card-id="agenda-filters">
    <header className={styles.header}>
      <h2><button type="button" className={styles.toggle} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(value => !value)}><span>Procuras uma consulta específica?</span><AppIcon name="arrowDown" /></button></h2>
      {active && <button type="button" className={`text-button ${styles.reset}`} onClick={onReset}><AppIcon name="reset" />Limpar filtros</button>}
    </header>
    {!open && <><button type="button" className={`${styles.selection} ${styles.prompt}`} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(true)}>Carrega aqui para pesquisar ou rola para ver a agenda em baixo</button>{active && <p className={styles.selection}>{summary}</p>}</>}
    <div id={bodyId} hidden={!open}>
      <p className={styles.help}>Faz aqui o filtro das consultas específicas que procuras.</p>
      <div className={styles.fields}>{children}</div>
    </div>
  </section>
}
