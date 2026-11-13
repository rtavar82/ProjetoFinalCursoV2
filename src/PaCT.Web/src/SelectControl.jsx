import AppArrow from './AppArrow'
import styles from './SelectControl.module.css'

export default function SelectControl({ children, variant = 'default', ...props }) {
  const showArrow = !props.multiple && !(props.size > 1) && !props.hidden
  return <span className={styles.field} data-ui="select-control" data-variant={variant} hidden={props.hidden}
    data-arrow-paused={props.disabled || props['aria-expanded'] ? 'true' : undefined}>
    <select {...props}>{children}</select>
    {showArrow && <span className={styles.indicator}><AppArrow direction="down" /></span>}
  </span>
}
