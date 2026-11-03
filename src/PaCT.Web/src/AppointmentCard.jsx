import { useId } from 'react'
import AppointmentSummary from './AppointmentSummary'
import styles from './AppointmentCard.module.css'

export default function AppointmentCard({ consultation, clientName, typeLabel, stateLabel, financialLabel, actionLabel, onOpen, disabled = false, cardId, children }) {
  const title = useId()
  return <article className={`ui-card ui-card--record ${styles.card}`} data-card-id={cardId || 'consultation-' + consultation.id} aria-labelledby={title}>
    <AppointmentSummary consultation={consultation} titleId={title} stateLabel={stateLabel} typeLabel={typeLabel} clientName={clientName} />
    {(financialLabel || children) && <div className={styles.extra}>{financialLabel && <p>{financialLabel}</p>}{children}</div>}
    {actionLabel && <div className={styles.actions}>
      {actionLabel && <button type="button" className={`text-button ${styles.action}`} disabled={disabled} onClick={() => onOpen(consultation.id)}>{actionLabel}</button>}
    </div>}
  </article>
}
