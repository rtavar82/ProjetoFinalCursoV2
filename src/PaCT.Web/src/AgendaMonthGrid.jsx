import { agendaDay, dayKey, monthDays, shiftMonth } from './agendaTime'
import styles from './ClientAgenda.module.css'

export default function AgendaMonthGrid({ calendar, selection, onSelect, hasItems, dayStatus, legend }) {
  const { data, loading, refreshing } = calendar
  const { day: selectedDay, month } = selection
  const firstDay = dayKey(data?.serverTime || new Date())
  const lastDay = data ? dayKey(new Date(Date.parse(data.horizonEndExclusive) - 1)) : null
  const firstMonth = firstDay.slice(0, 7), lastMonth = lastDay?.slice(0, 7)
  const firstOfMonth = new Date(month + '-01T12:00:00Z')
  const title = new Intl.DateTimeFormat('pt-PT', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(firstOfMonth)
  const offset = (firstOfMonth.getUTCDay() + 6) % 7
  function chooseMonth(value) {
    if (!/^\d{4}-\d{2}$/.test(value) || value < firstMonth || (lastMonth && value > lastMonth)) return
    onSelect({ month: value, day: value === firstMonth ? firstDay : value + '-01' })
  }
  return <div className={styles.calendar} aria-busy={loading || refreshing}>
    <div className={styles.monthTools}>
      <button type="button" className="text-button" aria-label="Mês anterior" disabled={month <= firstMonth} onClick={() => chooseMonth(shiftMonth(month, -1))}>‹</button>
      <label className={styles.monthTitle}>{title}<input className={styles.monthInput} aria-label="Mês da agenda" type="month" value={month} min={firstMonth} max={lastMonth} onChange={event => chooseMonth(event.target.value)} /></label>
      <button type="button" className="text-button" aria-label="Mês seguinte" disabled={!lastMonth || month >= lastMonth} onClick={() => chooseMonth(shiftMonth(month, 1))}>›</button>
    </div>
    <div className={styles.week} aria-hidden="true">{['seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.', 'dom.'].map(day => <span key={day}>{day}</span>)}</div>
    <div className={styles.days}>{Array.from({ length: offset }, (_, index) => <span key={'blank-' + index} />)}{monthDays(month).map(day => {
      const marked = hasItems(day)
      return <button type="button" key={day} aria-label={[agendaDay(day), marked && dayStatus].filter(Boolean).join(' · ')}
        aria-pressed={selectedDay === day} data-marked={marked} className={styles.day}
        disabled={!data || day < firstDay || day > lastDay} onClick={() => onSelect({ month, day })}>
        <span>{Number(day.slice(-2))}</span><span className={styles.dot} aria-hidden="true">{marked ? '•' : ''}</span>
      </button>
    })}</div>
    <p className={styles.legend}>● {legend}</p>
  </div>
}
