import { agendaClock, agendaDate, dayKey } from './agendaTime'
import Heading from './Heading'
import AppIcon from './AppIcon'
import styles from './AppointmentSummary.module.css'

export default function AppointmentSummary({ consultation, stateLabel, typeLabel, clientName, titleId, showTitle = true, location }) {
  const end = consultation.endsAt && (dayKey(consultation.startsAt) === dayKey(consultation.endsAt) ? agendaClock(consultation.endsAt) : agendaDate(consultation.endsAt))
  const publicLocation = consultation.modality === 'Remote' ? 'Online' : [consultation.publicLocation, consultation.modality === 'InPerson' ? 'Presencial' : null].filter(Boolean).join(' · ')
  const locationContent = location === undefined ? publicLocation && <p>{publicLocation}</p> : location
  return <div className={styles.summary}>
    {stateLabel && <div className={`notice success ${styles.state}`} data-typography="process-status">{stateLabel}</div>}
    {(showTitle || typeLabel || clientName) && <div className={styles.heading}>
      {showTitle && <Heading level={3} appearance="card-title" id={titleId}>{consultation.serviceTitle}</Heading>}
      {typeLabel && <p className={styles.type}>{typeLabel}</p>}
      {clientName && <p className={styles.client}>{clientName}</p>}
    </div>}
    <div className={styles.details}>
      <div className={styles.detail} data-ui="appointment-time">
        <AppIcon name="calendar" className={styles.detailIcon} />
        <p className={styles.detailContent}><time dateTime={consultation.startsAt}>{agendaDate(consultation.startsAt)}</time>{end && <> — <time dateTime={consultation.endsAt}>{end}</time></>}</p>
      </div>
      {locationContent && <div className={styles.detail} data-ui="appointment-location">
        <AppIcon name="pin" className={styles.detailIcon} />
        <div className={styles.detailContent}>{locationContent}</div>
      </div>}
    </div>
  </div>
}
