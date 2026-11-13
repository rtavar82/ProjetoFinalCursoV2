import ActionButton from './ActionButton'
import styles from './SectionTabs.module.css'

export default function SectionTabs({ label, items, value, onChange, disabled = false, columns = 4, variant = 'default', compactMobile = false }) {
  return <nav className={`${styles.tabs} ${variant === 'tools' ? styles.tools : ''} ${compactMobile ? styles.compactMobile : ''}`} aria-label={label} data-ui="section-tabs" data-columns={columns}>
    {items.map(item => <ActionButton key={item.id} variant={value === item.id ? 'primary' : item.variant || 'secondary'}
      className={item.count !== undefined ? styles.withCount : ''} data-typography={compactMobile ? 'compact-action' : undefined} aria-label={item.label}
      aria-pressed={value === item.id} disabled={disabled || item.disabled} onClick={() => onChange(item.id)}>
      {item.label}{item.count !== undefined && <span className={styles.count} aria-label={item.countLabel} title={item.countTitle}>{item.count}</span>}
    </ActionButton>)}
  </nav>
}
