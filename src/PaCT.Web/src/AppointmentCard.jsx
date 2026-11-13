import moneyText from './moneyText'
import { useId } from 'react'
import AppointmentSummary from './AppointmentSummary'
import ActionButton from './ActionButton'
import styles from './AppointmentCard.module.css'

export default function AppointmentCard({ consultation, clientName, typeLabel, stateLabel, financialLabel, actionLabel, actionVariant = 'text', onOpen, disabled = false, cardId, children }) {
  const title = useId()
  return <article className={`ui-card ui-card--record ${styles.card}`} data-card-id={cardId || 'consultation-' + consultation.id} aria-labelledby={title}>
    <AppointmentSummary consultation={consultation} titleId={title} stateLabel={stateLabel} typeLabel={typeLabel} clientName={clientName} />
    {(financialLabel || children) && <div className={styles.extra}>{financialLabel && <p data-typography="process-status">{moneyText(financialLabel)}</p>}{children}</div>}
    {actionLabel && <div className={styles.actions}>
      <ActionButton variant={actionVariant} className={actionVariant === 'text' ? styles.action : styles.buttonAction} disabled={disabled} onClick={() => onOpen(consultation.id)}>{actionLabel}</ActionButton>
    </div>}
  </article>
}
