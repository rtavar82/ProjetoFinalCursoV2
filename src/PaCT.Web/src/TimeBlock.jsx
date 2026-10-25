import styles from './TimeBlock.module.css'

const clock = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit' })

export default function TimeBlock({ startsAt, endsAt }) {
  return <div className={styles.block} data-time-block><strong><time dateTime={startsAt}>{clock.format(new Date(startsAt))}</time></strong><span><time dateTime={endsAt}>{clock.format(new Date(endsAt))}</time></span></div>
}
