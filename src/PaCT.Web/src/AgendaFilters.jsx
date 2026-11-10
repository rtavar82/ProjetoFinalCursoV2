import { useId, useState } from 'react'
import AppIcon from './AppIcon'
import Heading from './Heading'
import styles from './AgendaFilters.module.css'

export default function AgendaFilters({ active, summary, onReset, children }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  return <section className={styles.card} aria-label="Filtros da agenda" data-card-id="agenda-filters">
    <header className={styles.header}>
      <Heading level={2} appearance="card-title"><button type="button" data-typography="inherit" className={styles.toggle} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(value => !value)}><span>Procuras uma consulta específica?</span><AppIcon name="arrowDown" /></button></Heading>
      {active && <button type="button" className={`text-button ${styles.reset}`} onClick={onReset}><AppIcon name="reset" />Limpar filtros</button>}
    </header>
    {!open && <><button type="button" className={`${styles.selection} ${styles.prompt}`} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(true)}>Pesquisa ou desliza para a agenda.</button>{active && <p className={styles.selection}>{summary}</p>}</>}
    <div id={bodyId} hidden={!open}>
      <p className={styles.help}>Faz aqui o filtro das consultas específicas que procuras.</p>
      <div className={styles.fields}>{children}</div>
    </div>
  </section>
}
