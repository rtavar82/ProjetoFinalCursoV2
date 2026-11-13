import AppArrow from './AppArrow'
import AgendaShareReference from './AgendaShareReference'
import { agendaClock } from './agendaTime'
import styles from './ClientAgenda.module.css'

export default function AgendaSlotCard({ startsAt, reference, copyLabel, onOpen, children }) {
  const content = <><time dateTime={startsAt} className={styles.hour}>{agendaClock(startsAt)}</time><span>{children}</span></>
  return <div className={styles.slotCard}>
    {onOpen ? <button type="button" className={styles.slot} onClick={onOpen}>{content}<AppArrow direction="right" /></button>
      : <div className={styles.slot}>{content}</div>}
    {reference && <AgendaShareReference reference={reference} label={copyLabel} showReference={false} />}
  </div>
}
