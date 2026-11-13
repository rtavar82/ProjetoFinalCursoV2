import styles from './AppArrow.module.css'

const directions = new Set(['down', 'up', 'left', 'right'])

export default function AppArrow({ direction = 'down', className = '' }) {
  const orientation = directions.has(direction) ? direction : 'down'
  return <svg className={`${styles.arrow} ${className}`} data-ui="icon" data-arrow-direction={orientation}
    width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="m5.4 7.6 6.6 6.6 6.6-6.6L20 9l-8 8-8-8Z" />
  </svg>
}
