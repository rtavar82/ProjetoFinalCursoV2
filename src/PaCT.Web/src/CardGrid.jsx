import styles from './CardGrid.module.css'

export default function CardGrid({ children, className = '', ...props }) {
  return <div {...props} data-card-grid className={`${styles.grid} ${className}`}>{children}</div>
}
