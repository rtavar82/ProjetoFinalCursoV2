import styles from './BrandButterfly.module.css'

export default function BrandButterfly({ className = '', ...props }) {
  return <span {...props} data-ui="brand-butterfly" aria-hidden="true" className={`${styles.butterfly} ${className}`} />
}
