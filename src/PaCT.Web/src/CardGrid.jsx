import styles from './CardGrid.module.css'

export default function CardGrid({ children, className = '', layout, ...props }) {
  const appointments = layout === 'appointments'
  const grid = <div {...props} data-card-grid={appointments ? 'appointments' : ''} className={`${styles.grid} ${appointments ? styles.appointments : ''} ${className}`}>{children}</div>
  return appointments ? <div className={styles.container}>{grid}</div> : grid
}
