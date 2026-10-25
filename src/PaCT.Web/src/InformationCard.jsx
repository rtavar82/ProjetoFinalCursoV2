import { useId } from 'react'
import styles from './InformationCard.module.css'
import ActionButton from './ActionButton'

export default function InformationCard({ as: Element = 'section', title, headingLevel = 2, cardId, loading = false, refreshing = false, error, onRetry, actions, children, className = '', ...props }) {
  const generatedId = useId()
  const titleId = title ? `${generatedId}-title` : undefined
  const Heading = `h${headingLevel}`
  return <Element {...props} className={`${styles.card} ${className}`} data-card-id={cardId} aria-labelledby={titleId} aria-busy={loading || refreshing}>
    {(title || actions) && <header className={styles.header}>{title && <Heading id={titleId}>{title}</Heading>}{actions && <div className={styles.actions}>{actions}</div>}</header>}
    {loading && <p role="status">A carregar…</p>}
    {error && <div className="notice error" role="alert"><p>{error}</p>{onRetry && <ActionButton variant="secondary" onClick={onRetry}>Voltar a tentar</ActionButton>}</div>}
    <div className={styles.content}>{children}</div>
  </Element>
}
