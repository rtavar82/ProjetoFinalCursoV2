import { useId } from 'react'
import AppIcon from './AppIcon'
import TimeBlock from './TimeBlock'
import styles from './AppointmentCard.module.css'

const day = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', dateStyle: 'long' })

export default function AppointmentCard({ consultation, clientName, stateLabel, financialLabel, actionLabel, onOpen }) {
  const title = useId()
  return <article className={styles.card} data-card-id={'consultation-' + consultation.id} aria-labelledby={title}>
    <TimeBlock startsAt={consultation.startsAt} endsAt={consultation.endsAt} />
    <div className={styles.content}><p className={styles.day}>{day.format(new Date(consultation.startsAt))}</p><h3 id={title}>{consultation.serviceTitle}</h3>
      {clientName && <p>{clientName}</p>}
      {(consultation.publicLocation || consultation.modality) && <p className={styles.location}><AppIcon name={consultation.modality === 'Remote' ? 'video' : 'pin'} /><span>{[consultation.publicLocation, consultation.modality ? consultation.modality === 'Remote' ? 'Online' : 'Presencial' : null].filter(Boolean).join(' · ')}</span></p>}
      <p className={styles.state}>{stateLabel}</p><p className={styles.financial}>{financialLabel}</p>
    </div>
    <button type="button" className={styles.action} onClick={() => onOpen(consultation.id)}>{actionLabel}<AppIcon name="arrow" /></button>
  </article>
}
