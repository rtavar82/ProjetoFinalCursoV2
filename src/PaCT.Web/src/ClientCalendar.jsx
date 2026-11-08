import AdaptiveSelect from './AdaptiveSelect'
import { useCallback, useMemo, useState } from 'react'
import useAgendaCalendar from './useAgendaCalendar'
import AppIcon from './AppIcon'
import AgendaMonthGrid from './AgendaMonthGrid'
import AgendaSlotCard from './AgendaSlotCard'
import useLiveResource from './useLiveResource'
import { apiRequest } from './identityApi'
import AgendaFilters from './AgendaFilters'
import { agendaDate, agendaDay, monthDays, addDays, instant } from './agendaTime'
import { bookingVariants, bookableSlots, physicalLocations, publishedSlotDetails } from './clientBookingOptions'
import { searchPublishedAgenda } from './publishedAgendaSearch'
import styles from './ClientAgenda.module.css'
import publicStyles from './VisitorAgenda.module.css'

export default function ClientCalendar({ onChoose, onEvent, enabled = true, visitor = false, publicOnly = false, initialServiceId = '', shareRole }) {
  const { selection, setSelection, calendar } = useAgendaCalendar({ enabled, publicOnly })
  const [chosenType, setType] = useState(null), [place, setPlace] = useState(''), [modality, setModality] = useState('')
  const data = calendar.data
  const readSharing = useCallback(signal => apiRequest('sharing/capabilities', undefined, { signal }), [])
  const sharing = useLiveResource('sharing', 'sharing-capabilities', readSharing, enabled && shareRole === 'client')
  const canShare = shareRole === 'manager' || sharing.data?.canPublish === true
  const services = data?.services || []
  const type = chosenType ?? (services.find(service => service.id === initialServiceId)?.title || '')
  const hasFilters = !!(type || place || modality)
  function resetFilters() { setType(''); setPlace(''); setModality('') }
  const searched = useMemo(() => searchPublishedAgenda(data, { type, place, modality }), [data, type, place, modality])
  const variants = useMemo(() => bookingVariants(data?.services), [data])
  const events = searched?.events || []
  const slotsByDay = useMemo(() => Object.fromEntries(monthDays(selection.month).map(day => [day, bookableSlots(searched, day, variants)])), [searched, selection.month, variants])
  const slots = slotsByDay[selection.day] || []
  const eventsForDay = day => events.filter(e => Date.parse(e.startsAt) < Date.parse(instant(addDays(day, 1) + 'T00:00')) && Date.parse(e.endsAt) > Date.parse(instant(day + 'T00:00')))
  const visibleEvents = eventsForDay(selection.day)
  const rows = [...slots.map(slot => ({ key: slot.startsAt, startsAt: slot.startsAt, slot })), ...visibleEvents.map(event => ({ key: event.id, startsAt: event.startsAt, event }))]
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.key.localeCompare(b.key))
  const hasAvailability = day => slotsByDay[day]?.length > 0
    || eventsForDay(day).some(e => e.state === 'Waiting' && !e.scheduleBlocked && Date.parse(e.startsAt) > Date.parse(data.serverTime))
  const places = [...new Set([...physicalLocations(data), ...(data?.events || []).map(e => e.publicLocation)].filter(Boolean))]
  return <section className={visitor ? styles.visitorCalendar : undefined} aria-label="Calendário da agenda">
    <AgendaFilters active={hasFilters} summary={[type, place, modality === 'Remote' ? 'Remota' : modality === 'InPerson' ? 'Presencial' : ''].filter(Boolean).join(' · ')} onReset={resetFilters}>
          <label>Tipo de consulta<AdaptiveSelect aria-label="Tipo de consulta" value={type} onChange={e => setType(e.target.value)}><option value="">Todas as consultas e atividades</option>{[...new Set([...services.map(s => s.title), ...(data?.events || []).map(e => e.title)])].map(name => <option key={name}>{name}</option>)}</AdaptiveSelect></label>
      <label>Local<AdaptiveSelect aria-label="Local" value={place} onChange={e => setPlace(e.target.value)}><option value="">Todos os locais</option>{places.map(name => <option key={name}>{name}</option>)}</AdaptiveSelect></label>
      <label>Modalidade<AdaptiveSelect aria-label="Modalidade" value={modality} onChange={e => setModality(e.target.value)}><option value="">Todas as modalidades</option><option value="InPerson">Presencial</option><option value="Remote">Remota</option></AdaptiveSelect></label>
    </AgendaFilters>
    <div className={styles.calendarTools}><span>Hora local: Lisboa</span><button type="button" className="text-button" onClick={calendar.refresh}>Atualizar horários</button></div>
    {calendar.error && <p className="notice error" role="alert">{calendar.error}</p>}{calendar.loading && <p role="status">A consultar a agenda…</p>}
    <div className={styles.calendarLayout}>
    <AgendaMonthGrid calendar={calendar} selection={selection} onSelect={setSelection} hasItems={hasAvailability}
      dayStatus="Com disponibilidade" legend="Dias com disponibilidade" />
    <section className={styles.schedule} aria-label="Disponibilidade do dia"><p className={styles.eyebrow}>Disponibilidade do dia</p><div className={visitor ? publicStyles.dayHeading : undefined}><h2>{visitor ? new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', weekday: 'long', day: 'numeric' }).format(new Date(instant(selection.day + 'T12:00'))) : agendaDay(selection.day)}</h2>{visitor && <span>{new Intl.DateTimeFormat('pt-PT', { timeZone: 'UTC', month: 'long' }).format(new Date(selection.day + 'T12:00:00Z'))}</span>}</div>
      {data && <><p className={styles.muted}>{slots.length} {slots.length === 1 ? 'horário individual' : 'horários individuais'}{visibleEvents.length ? ` · ${visibleEvents.length} ${visibleEvents.length === 1 ? 'atividade' : 'atividades'}` : ''}</p>
        {rows.map(row => {
          if (row.event) {
            const event = row.event
            const reference = canShare && event.state === 'Waiting' && Date.parse(event.startsAt) > Date.parse(data.serverTime) ? event.id : ''
            return <AgendaSlotCard key={event.id} startsAt={event.startsAt} reference={reference} onOpen={() => onEvent(event.id, { ...event, services })}>
              <strong>{event.title}</strong>
              <small>{event.kind === 'Retreat' ? 'Retiro' : 'Grupo'} · {event.publicLocation}</small>
              {visitor && event.kind === 'Retreat' && <small>{agendaDate(event.startsAt)} — {agendaDate(event.endsAt)}</small>}
              <small>{event.state === 'Cancelled' ? 'Cancelado' : event.state === 'Performed' ? 'Realizado' : event.scheduleBlocked ? 'Inscrições indisponíveis' : event.remaining ? `${event.remaining} vagas disponíveis` : 'Inscrições completas'}</small>
            </AgendaSlotCard>
          }
          const slot = row.slot, details = publishedSlotDetails(slot, services)
          const reference = canShare && slot.windowIds[0] ? slot.windowIds[0] + '@' + Math.floor(Date.parse(slot.startsAt) / 1000) : ''
          return <AgendaSlotCard key={slot.startsAt} startsAt={slot.startsAt} reference={reference} copyLabel="Copiar referência do horário"
            onOpen={() => onChoose({ ...slot, services })}>
            <strong>{details.title}</strong>
            <small>{[details.modality, details.location].filter(Boolean).join(' · ')}</small>
            {details.registeredOnly && <small>Só registados</small>}
          </AgendaSlotCard>
        })}
        {!slots.length && !visibleEvents.length && <div className={styles.empty}><AppIcon name="calendar" /><h3>Sem horários disponíveis</h3><p>Escolhe outro dia ou ajusta os filtros.</p></div>}
      </>}
    </section></div>
  </section>
}
