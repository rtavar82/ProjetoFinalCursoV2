import moneyText from './moneyText'
import AppIcon from './AppIcon'
import Heading from './Heading'
import styles from './SummaryCard.module.css'

export default function SummaryCard({ label, value, unit, icon, cardId, children, variant = 'default' }) {
  if (variant === 'compact') return <div className={styles.compact} data-card-id={cardId}>
    <Heading level={2}>{label}</Heading>
    <p role="status"><strong>{moneyText(unit === '€' ? `${value ?? '—'} €` : value ?? '—')}</strong>{unit && unit !== '€' && <span> {unit}</span>}</p>
    {children}
  </div>
  return <article className={`ui-card ${styles.card}`} data-card-id={cardId} role="status"><div className={styles.label}><span>{label}</span>{icon && <AppIcon name={icon} />}</div><strong className={styles.value} data-typography="count">{moneyText(unit === '€' ? `${value ?? '—'} €` : value ?? '—')}{unit && unit !== '€' && <span className={styles.unit} data-typography="body"> {unit}</span>}</strong>{children && <div className={styles.detail}>{children}</div>}</article>
}
