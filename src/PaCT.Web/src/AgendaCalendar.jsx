import { useCallback, useMemo, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import InformationCard from './InformationCard'
import TimeBlock from './TimeBlock'
import AppIcon from './AppIcon'
import AgendaFilters from './AgendaFilters'
import { bookableSlots } from './clientBookingOptions'
import { hasAgendaSearch, searchPublishedAgenda } from './publishedAgendaSearch'
import { addDays, agendaClock, agendaDay, agendaStates, availableStarts, dayIntervals, dayKey, instant, monthDays, servicePrice, shiftMonth } from './agendaTime'
import styles from './AgendaCalendar.module.css'

export default function AgendaCalendar({ manager = false, visitor = false, enabled = true, initialServiceId = '', onChoose, onDay }) {
  const [selection, setSelection] = useState(() => { const day = dayKey(new Date()); return { month: day.slice(0, 7), day } })
  const [serviceId, setServiceId] = useState(initialServiceId)
  const [optionId, setOptionId] = useState('')
  const [location, setLocation] = useState('')
  const [modality, setModality] = useState('')
  const read = useCallback(async signal => {
    const value = await apiRequest(`consultations/calendar?month=${selection.month}`, undefined, { signal })
    if (value.timeZone !== 'Europe/Lisbon' || !Array.isArray(value.services) || !Array.isArray(value.intervals)
      || ![value.startsAt, value.endsAt, value.serverTime, value.horizonEndExclusive].every(x => Number.isFinite(Date.parse(x)))) throw new Error('Não foi possível ler a agenda. Tenta novamente.')
    return value
  }, [selection.month])
  const calendar = useLiveResource('agenda', 'calendar:' + selection.month, read, enabled)
  const data = calendar.data
  const firstDay = data ? dayKey(data.serverTime) : dayKey(new Date())
  const lastDay = data ? dayKey(new Date(Date.parse(data.horizonEndExclusive) - 1)) : null
  const variants = (data?.services || []).filter(s => !s.serviceKind).flatMap(s => (s.bookingOptions || [{ id: 'standard', modality: s.modality, publicLocation: s.publicLocation }]).map(o => ({ ...s, ...o, id: s.id, optionId: o.id, durationMinutes: o.durationMinutes ?? s.durationMinutes, paymentMode: o.paymentMode ?? s.paymentMode, referencePrice: o.referencePrice ?? s.referencePrice })))
  const choices = variants.filter(s => (!location || s.publicLocation === location) && (!modality || s.modality === modality))
  const services = data?.services || []
  const hasFilters = hasAgendaSearch({ serviceId, place: location, modality })
  const searched = useMemo(() => searchPublishedAgenda(data, { serviceId, place: location, modality }), [data, serviceId, location, modality])
  const activity = services.find(s => s.id === serviceId && s.serviceKind)
  const eventsForDay = day => (searched?.events || []).filter(event => Date.parse(event.startsAt) < Date.parse(instant(addDays(day, 1) + 'T00:00')) && Date.parse(event.endsAt) > Date.parse(instant(day + 'T00:00')))
  const activityDates = eventsForDay(selection.day).filter(event => event.serviceId === serviceId)
  const options = choices.filter(s => s.id === serviceId)
  const service = options.find(s => s.optionId === optionId) || (options.length === 1 ? options[0] : null)
  const intervals = dayIntervals(searched, selection.day)
  const slots = availableStarts(searched, selection.day, service)
  const matchingSlots = bookableSlots(searched, selection.day, variants)
  const matchingEvents = eventsForDay(selection.day)
  const visibleServices = hasFilters ? services.filter(item => item.serviceKind ? matchingEvents.some(event => event.serviceId === item.id) : matchingSlots.some(slot => slot.choices.some(choice => choice.id === item.id))) : services
  const days = monthDays(selection.month)
  const offset = (new Date(selection.month + '-01T12:00:00Z').getUTCDay() + 6) % 7
  const monthTitle = new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(selection.month + '-01T12:00:00Z'))
  function month(value) {
    if (!/^\d{4}-\d{2}$/.test(value) || value < firstDay.slice(0, 7) || (lastDay && value > lastDay.slice(0, 7))) return
    setSelection({ month: value, day: value === firstDay.slice(0, 7) ? firstDay : value + '-01' })
  }
  function resetFilters() { setServiceId(''); setOptionId(''); setLocation(''); setModality('') }
  function chooseService(value) { setServiceId(value); setOptionId('') }
  return <section className={styles.page} aria-label="Calendário da agenda">
    <AgendaFilters active={!!(serviceId || location || modality || optionId)} summary={[services.find(item => item.id === serviceId)?.title, location, modality === 'Remote' ? 'Online' : modality === 'InPerson' ? 'Presencial' : ''].filter(Boolean).join(' · ')} onReset={resetFilters}>
      <label>Tipo de consulta<select aria-label="Tipo de consulta" value={serviceId} onChange={e => chooseService(e.target.value)}><option value="">Todas as consultas</option>{services.map(s => <option value={s.id} key={s.id}>{s.title}</option>)}</select></label>
      <label>Local<select aria-label="Local" value={location} onChange={e => { setLocation(e.target.value); setOptionId('') }}><option value="">Todos os locais</option>{[...new Set([...variants.map(s => s.publicLocation), ...(data?.events || []).map(event => event.publicLocation)].filter(Boolean))].map(x => <option key={x}>{x}</option>)}</select></label>
      <label>Modalidade<select aria-label="Modalidade" value={modality} onChange={e => { setModality(e.target.value); setOptionId('') }}><option value="">Todas</option><option value="InPerson">Presencial</option><option value="Remote">Online</option></select></label>
      {options.length > 1 && <label>Modalidade e local<select aria-label="Modalidade e local" value={optionId} onChange={e => setOptionId(e.target.value)}><option value="">Escolhe a modalidade e o local</option>{options.map(o => <option value={o.optionId} key={o.optionId}>{o.modality === 'Remote' ? 'Online' : o.publicLocation} · {servicePrice(o)}</option>)}</select></label>}
    </AgendaFilters>
    {calendar.error && <InformationCard cardId="calendar-error" error={calendar.error} onRetry={calendar.refresh} />}
    {calendar.loading && <p role="status">A consultar a agenda…</p>}
    <div className={styles.layout}>
      <section className={styles.month} aria-label={`Calendário de ${monthTitle}`} aria-busy={calendar.loading || calendar.refreshing}>
        <div className={styles.monthControls}>
          <button className="secondary" aria-label="Mês anterior" disabled={selection.month <= firstDay.slice(0, 7)} onClick={() => month(shiftMonth(selection.month, -1))}>‹</button>
          <label><span className={styles.srOnly}>Mês da agenda</span><input aria-label="Mês da agenda" type="month" value={selection.month} min={firstDay.slice(0, 7)} max={lastDay?.slice(0, 7)} onChange={e => month(e.target.value)} /></label>
          <button className="secondary" aria-label="Mês seguinte" disabled={!lastDay || selection.month >= lastDay.slice(0, 7)} onClick={() => month(shiftMonth(selection.month, 1))}>›</button>
        </div>
        <div className={styles.week} aria-hidden="true">{['seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.', 'dom.'].map(x => <span key={x}>{x}</span>)}</div>
        <div className={styles.days}>
          {Array.from({ length: offset }, (_, index) => <span key={'empty-' + index} />)}
          {days.map(day => {
            const states = [...new Set(dayIntervals(searched, day).map(x => x.state))]
            const available = hasFilters ? bookableSlots(searched, day, variants).length > 0 || eventsForDay(day).some(event => event.state === 'Scheduled' && event.remaining > 0 && Date.parse(event.startsAt) > Date.parse(data.serverTime)) : states.includes('Available')
            return <button key={day} className={styles.day} data-available={available} aria-label={`${agendaDay(day)}${states.length ? ' · ' + states.map(x => agendaStates[x]).join(', ') : ''}`} aria-pressed={selection.day === day} disabled={!data || day < firstDay || (lastDay && day > lastDay)} onClick={() => setSelection({ ...selection, day })}><span>{Number(day.slice(-2))}</span><span aria-hidden="true" className={styles.dot}>{available ? '•' : ' '}</span></button>
          })}
        </div>
        <p className={styles.legend}><span aria-hidden="true">●</span> Dias com disponibilidade</p>
      </section>
      <section className={styles.schedule} aria-labelledby="calendar-day-heading">
        <h2 id="calendar-day-heading">{agendaDay(selection.day)}</h2>
        {manager && onDay && <button type="button" className="text-button" onClick={() => onDay(selection.day)}>Ver marcações deste dia</button>}
        {data && <>
          {!service && !activity && <>{visibleServices.length > 0 && <p>Escolhe a consulta para veres os horários que permitem a sua duração.</p>}<div className={styles.services}>{visibleServices.map(s => <button className="secondary" key={s.id} onClick={() => chooseService(s.id)}><strong>{s.title}</strong><span>{s.serviceKind ? 'Duração definida na ocorrência' : `${s.durationMinutes} min`} · {servicePrice(s)}</span><span>{s.modality === 'Remote' ? 'Online' : s.publicLocation}</span></button>)}</div>{visibleServices.length === 0 && <p>Não existem consultas publicadas para esta seleção.</p>}</>}
          {activity && <><h3>{activity.title}</h3>{activityDates.length ? activityDates.map(item => <button type="button" className={styles.slot} key={item.id} onClick={() => onChoose?.({ eventId: item.id, serviceId: item.serviceId, startsAt: item.startsAt })}><TimeBlock startsAt={item.startsAt} endsAt={item.endsAt} /><span>{item.publicLocation} · {item.remaining} vagas</span><AppIcon name="arrow" /></button>) : <p className="notice">Não existem ocorrências desta atividade neste dia.</p>}</>}
          {service && <><p>{service.title} · {service.durationMinutes} min · {servicePrice(service)}</p><div className={styles.slots}>{slots.map(start => <button className={styles.slot} key={`${service.id}:${start}`} onClick={() => onChoose?.({ serviceId: service.id, startsAt: start, service, serviceVersion: service.version, deliveryOptionId: service.optionId })}>
            <TimeBlock startsAt={start} endsAt={new Date(Date.parse(start) + service.durationMinutes * 60000).toISOString()} /><span><strong>{service.title}</strong><span>{service.modality === 'Remote' ? 'Online' : service.publicLocation}</span><span>{visitor ? 'Pedir este horário' : manager ? 'Criar marcação' : 'Pedir este horário'}</span></span><AppIcon name="arrow" />
          </button>)}</div>{slots.length === 0 && <p className="notice">Não há horários disponíveis para esta consulta neste dia.</p>}</>}
          <details className={styles.intervals}><summary>Ver a disponibilidade do dia</summary>{intervals.length ? intervals.map(x => <p key={x.startsAt}><time dateTime={x.startsAt}>{agendaClock(x.startsAt)}</time>–<time dateTime={x.endsAt}>{x.endsAt === instant(addDays(selection.day, 1) + 'T00:00') ? '24:00' : agendaClock(x.endsAt)}</time> · {agendaStates[x.state]}</p>) : <p>Não há horários futuros publicados neste dia.</p>}</details>
          <p className={styles.legend}>Horas de Lisboa. A disponibilidade é confirmada ao enviar o pedido.</p>
        </>}
      </section>
    </div>
  </section>
}
