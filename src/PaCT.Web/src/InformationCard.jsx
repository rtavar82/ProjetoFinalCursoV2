import moneyText from './moneyText'
import { useId } from 'react'
import styles from './InformationCard.module.css'
import ActionButton from './ActionButton'
import Heading from './Heading'

export default function InformationCard({ as: Element = 'section', title, headingLevel = 2, cardId, loading = false, refreshing = false, error, onRetry, actions, footer, children, className = '', variant = 'default', ...props }) {
  const generatedId = useId()
  const titleId = title ? `${generatedId}-title` : undefined
  return <Element {...props} className={`ui-card ${variant === 'plain' ? 'ui-card--plain' : ''} ${styles.card} ${footer ? styles.withFooter : ''} ${className}`} data-card-id={cardId} aria-labelledby={props['aria-labelledby'] || (props['aria-label'] ? undefined : titleId)} aria-busy={loading || refreshing}>
    {(title || actions) && <header className={styles.header}>{title && <Heading level={headingLevel} appearance="card-title" id={titleId}>{title}</Heading>}{actions && <div className={styles.actions}>{actions}</div>}</header>}
    {loading && <p role="status">A carregar…</p>}
    {error && <div className="notice error" role="alert"><p>{error}</p>{onRetry && <ActionButton variant="secondary" onClick={onRetry}>Voltar a tentar</ActionButton>}</div>}
    <div className={styles.content}>{moneyText(children)}</div>
    {footer && <footer className={styles.footer} data-ui="card-actions">{footer}</footer>}
  </Element>
}
