import AppArrow from './AppArrow'
import styles from './DisclosureSummary.module.css'

export default function DisclosureSummary({ className = '', children, ...props }) {
  return <summary {...props} data-ui="disclosure" className={`${styles.summary} ${className}`}>
    {children}<AppArrow direction="down" />
  </summary>
}
