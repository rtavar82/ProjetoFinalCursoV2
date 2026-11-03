import ActionButton from './ActionButton'
import styles from './Pagination.module.css'

export default function Pagination({ total, page, pageSize = 8, onChange, disabled = false, label = 'Paginação', showTotal = false }) {
  const pages = Math.ceil(total / pageSize)
  if (!(pages > 1)) return null
  return <nav className={styles.pager} aria-label={label}>
    <ActionButton variant="secondary" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>Anterior</ActionButton>
    <span>Página {page}{showTotal ? ` de ${pages}` : ''}</span>
    <ActionButton variant="secondary" disabled={disabled || page >= pages} onClick={() => onChange(page + 1)}>Seguinte</ActionButton>
  </nav>
}
