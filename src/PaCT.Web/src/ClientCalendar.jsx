import { useCallback, useMemo, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import AppIcon from './AppIcon'
import AgendaFilters from './AgendaFilters'
import { agendaClock, agendaDate, agendaDay, dayKey, monthDays, shiftMonth, addDays, instant } from './agendaTime'
import { bookingVariants, bookableSlots, validBookingCatalogue } from './clientBookingOptions'
import { searchPublishedAgenda } from './publishedAgendaSearch'
import styles from './ClientAgenda.module.css'
import publicStyles from './VisitorAgenda.module.css'

export default function ClientCalendar({ onChoose, onEvent, enabled = true, visitor = false, initialServiceId = '' }) {
  const [selection, setSelection] = useState(() => { const day = dayKey(new Date()); return { month: day.slice(0, 7), day } })
  const [chosenType, setType] = useState(null), [place, setPlace] = useState(''), [modality, setModality] = useState('')
  const read = useCallback(async signal => {
    const value = await apiRequest('consultations/calendar?month=' + selection.month, undefined, { signal })
    if (!validBookingCatalogue(value) || value.timeZone !== 'Europe/Lisbon' || !Array.isArray(value.intervals)
      || ![value.serverTime, value.startsAt, value.endsAt, value.horizonEndExclusive].every(v => Number.isFinite(Date.parse(v)))
      || value.events != null && (!Array.isArray(value.events) || value.events.some(e => !Number.isFinite(Date.parse(e.startsAt)) || !Number.isFinite(Date.parse(e.endsAt))))) throw new Error('Não foi possível ler a agenda. Tenta novamente.')
    return value
  }, [selection.month])
  const calendar = useLiveResource('agenda', 'calendar:' + selection.month, read, enabled), data = calendar.data
  const services = data?.services || []
  const type = chosenType ?? (services.find(service => service.id === initialServiceId)?.title || '')
  const hasFilters = !!(type || place || modality)
  function resetFilters() { setType(''); setPlace(''); setModality('') }
  const publishedSlots = useMemo(() => bookableSlots(data, selection.day, bookingVariants(data?.services)), [data, selection.day])
  const searched = useMemo(() => searchPublishedAgenda(data, { type, place, modality }), [data, type, place, modality])
  const variants = useMemo(() => bookingVariants(data?.services), [data])
  const events = searched?.events || []
  const days = monthDays(selection.month)
  const firstDay = data ? dayKey(data.serverTime) : dayKey(new Date()), lastDay = data ? dayKey(new Date(Date.parse(data.horizonEndExclusive) - 1)) : null
  const slotsByDay = useMemo(() => Object.fromEntries(monthDays(selection.month).map(day => [day, bookableSlots(searched, day, variants)])), [searched, selection.month, variants])
  const slots = slotsByDay[selection.day] || []
  const eventsForDay = day => events.filter(e => Date.parse(e.startsAt) < Date.parse(instant(addDays(day, 1) + 'T00:00')) && Date.parse(e.endsAt) > Date.parse(instant(day + 'T00:00')))
  const visibleEvents = eventsForDay(selection.day)
  const rows = [...slots.map(slot => ({ key: slot.startsAt, startsAt: slot.startsAt, slot })), ...visibleEvents.map(event => ({ key: event.id, startsAt: event.startsAt, event }))]
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.key.localeCompare(b.key))
  const title = new Intl.DateTimeFormat('pt-PT', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(selection.month + '-01T12:00:00Z'))
  const offset = (new Date(selection.month + '-01T12:00:00Z').getUTCDay() + 6) % 7
  function month(value) {
    if (!/^\d{4}-\d{2}$/.test(value) || value < firstDay.slice(0, 7) || (lastDay && value > lastDay.slice(0, 7))) return
    setSelection({ month: value, day: value === firstDay.slice(0, 7) ? firstDay : value + '-01' })
  }
  const places = [...new Set([...bookingVariants(services).map(s => s.publicLocation), ...(data?.events || []).map(e => e.publicLocation)].filter(Boolean))]
  return <section className={visitor ? styles.visitorCalendar : undefined} aria-label="Calendário da agenda">
    <AgendaFilters active={hasFilters} summary={[type, place, modality === 'Remote' ? 'Remota' : modality === 'InPerson' ? 'Presencial' : ''].filter(Boolean).join(' · ')} onReset={resetFilters}>
          <label>Tipo de consulta<select aria-label="Tipo de consulta" value={type} onChange={e => setType(e.target.value)}><option value="">Todas as consultas e atividades</option>{[...new Set([...services.map(s => s.title), ...(data?.events || []).map(e => e.title)])].map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Local<select aria-label="Local" value={place} onChange={e => setPlace(e.target.value)}><option value="">Todos os locais</option>{places.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Modalidade<select aria-label="Modalidade" value={modality} onChange={e => setModality(e.target.value)}><option value="">Todas as modalidades</option><option value="InPerson">Presencial</option><option value="Remote">Remota</option></select></label>
    </AgendaFilters>
    <div className={styles.calendarTools}><span>Hora local: Lisboa</span><button type="button" className="text-button" onClick={calendar.refresh}>Atualizar horários</button></div>
    {calendar.error && <p className="notice error" role="alert">{calendar.error}</p>}{calendar.loading && <p role="status">A consultar a agenda…</p>}
    <div className={styles.calendarLayout}><div className={styles.calendar} aria-busy={calendar.loading || calendar.refreshing}>
      <div className={styles.monthTools}><button type="button" className="text-button" aria-label="Mês anterior" disabled={selection.month <= firstDay.slice(0, 7)} onClick={() => month(shiftMonth(selection.month, -1))}>‹</button><label className={styles.monthTitle}>{title}<input className={styles.monthInput} aria-label="Mês da agenda" type="month" value={selection.month} min={firstDay.slice(0, 7)} max={lastDay?.slice(0, 7)} onChange={e => month(e.target.value)} /></label><button type="button" className="text-button" aria-label="Mês seguinte" disabled={!lastDay || selection.month >= lastDay.slice(0, 7)} onClick={() => month(shiftMonth(selection.month, 1))}>›</button></div>
      <div className={styles.week} aria-hidden="true">{['seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.', 'dom.'].map(day => <span key={day}>{day}</span>)}</div>
      <div className={styles.days}>{Array.from({ length: offset }, (_, index) => <span key={'blank-' + index} />)}{days.map(day => {
        const available = slotsByDay[day]?.length > 0 || eventsForDay(day).some(e => e.state === 'Scheduled' && e.remaining > 0 && Date.parse(e.startsAt) > Date.parse(data.serverTime))
        return <button type="button" key={day} aria-label={agendaDay(day) + (available ? ' · Com disponibilidade' : '')} aria-pressed={selection.day === day} data-available={available} className={styles.day} disabled={!data || day < firstDay || day > lastDay} onClick={() => setSelection({ ...selection, day })}><span>{Number(day.slice(-2))}</span><span className={styles.dot} aria-hidden="true">{available ? '•' : ''}</span></button>
      })}</div><p className={styles.legend}>● Dias com disponibilidade</p>
    </div>
    <section className={styles.schedule} aria-label="Disponibilidade do dia"><p className={styles.eyebrow}>Disponibilidade do dia</p><div className={visitor ? publicStyles.dayHeading : undefined}><h2>{visitor ? new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', weekday: 'long', day: 'numeric' }).format(new Date(instant(selection.day + 'T12:00'))) : agendaDay(selection.day)}</h2>{visitor && <span>{new Intl.DateTimeFormat('pt-PT', { timeZone: 'UTC', month: 'long' }).format(new Date(selection.day + 'T12:00:00Z'))}</span>}</div>
      {data && <><p className={styles.muted}>{slots.length} {slots.length === 1 ? 'horário individual' : 'horários individuais'}{visibleEvents.length ? ` · ${visibleEvents.length} ${visibleEvents.length === 1 ? 'atividade' : 'atividades'}` : ''}</p>
        {rows.map(row => {
          if (row.event) { const event = row.event; return <button type="button" className={styles.slot} key={event.id} onClick={() => onEvent(event.id, { ...event, services })}><time dateTime={event.startsAt} className={styles.hour}>{agendaClock(event.startsAt)}</time><span><strong>{event.title}</strong><small>{event.kind === 'Retreat' ? 'Retiro' : 'Grupo'} · {event.publicLocation}</small>{visitor && event.kind === 'Retreat' && <small>{agendaDate(event.startsAt)} — {agendaDate(event.endsAt)}</small>}<small>{event.state === 'Cancelled' ? 'Cancelado' : event.state === 'Performed' ? 'Realizado' : event.remaining ? `${event.remaining} vagas disponíveis` : 'Inscrições completas'}</small></span><AppIcon name="arrow" /></button> }
          const slot = row.slot, publishedChoices = publishedSlots.find(item => item.startsAt === slot.startsAt)?.choices || slot.choices
          const modes = [...new Set(publishedChoices.map(s => s.modality))], locations = [...new Set(publishedChoices.map(s => s.publicLocation).filter(Boolean))]
          return <button key={slot.startsAt} type="button" className={styles.slot} onClick={() => onChoose({ ...slot, services })}><time dateTime={slot.startsAt} className={styles.hour}>{agendaClock(slot.startsAt)}</time><span><strong>Horário livre</strong><small>{modes.length > 1 ? 'Modalidade à escolha' : modes[0] === 'Remote' ? 'Remota' : 'Presencial'}{modes[0] !== 'Remote' || modes.length > 1 ? ' · ' + (locations.length === 1 ? locations[0] : 'Local à escolha') : ''}</small></span><AppIcon name="arrow" /></button>
        })}
        {!slots.length && !visibleEvents.length && <div className={styles.empty}><AppIcon name="calendar" /><h3>Sem horários disponíveis</h3><p>Escolhe outro dia ou ajusta os filtros.</p></div>}
      </>}
    </section></div>
  </section>
}
