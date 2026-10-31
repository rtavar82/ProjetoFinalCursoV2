import AppIcon from './AppIcon'
import styles from './SummaryCard.module.css'

export default function SummaryCard({ label, value, unit, icon, cardId, children }) {
  return <article className={styles.card} data-card-id={cardId} role="status"><div className={styles.label}><span>{label}</span>{icon && <AppIcon name={icon} />}</div><strong className={styles.value}>{value ?? '—'}{unit && <span className={styles.unit}> {unit}</span>}</strong>{children && <div className={styles.detail}>{children}</div>}</article>
}
