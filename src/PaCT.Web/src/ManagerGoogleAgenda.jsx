import { useMemo } from 'react'
import ActionButton from './ActionButton'
import AgendaMonthGrid from './AgendaMonthGrid'
import AgendaSlotCard from './AgendaSlotCard'
import AppIcon from './AppIcon'
import { GoogleCalendarConnectButton } from './GoogleCalendarPanel'
import Heading from './Heading'
import useAgendaCalendar from './useAgendaCalendar'
import { apiRequest } from './identityApi'
import { addDays, agendaClock, agendaDay, instant, monthDays } from './agendaTime'
import styles from './ClientAgenda.module.css'
import managerStyles from './ManagerAgenda.module.css'

async function readOccupation(month, { signal }) {
  const path = 'management/google-calendar/occupation'
  let value
  try {
    value = await apiRequest(path + (month ? '?' + new URLSearchParams({ month }) : ''), undefined, { signal })
  } catch (failure) {
    if (!month || failure.status !== 400) throw failure
    value = await apiRequest(path, undefined, { signal })
  }
  if (!Array.isArray(value.blocks) || ![value.serverTime, value.startsAt, value.endsAt, value.horizonEndExclusive].every(v => Number.isFinite(Date.parse(v)))
    || value.blocks.some(block => ![block.startsAt, block.endsAt].every(v => Number.isFinite(Date.parse(v)))))
    throw new Error('Não foi possível ler a agenda. Tenta novamente.')
  return value
}

function dayBounds(day) {
  return [Date.parse(instant(day + 'T00:00')), Date.parse(instant(addDays(day, 1) + 'T00:00'))]
}

export default function ManagerGoogleAgenda({ onBack, onOpen, guard, busy }) {
  const { calendar, selection, setSelection } = useAgendaCalendar({ readCalendar: readOccupation, resourceKey: 'occupation' })
  const data = calendar.data
  const blocksByDay = useMemo(() => Object.fromEntries(monthDays(selection.month).map(day => {
    const [start, end] = dayBounds(day)
    return [day, (data?.blocks || []).filter(block => Date.parse(block.startsAt) < end && Date.parse(block.endsAt) > start)]
  })), [data, selection.month])
  const blocks = blocksByDay[selection.day] || []
  const [dayStart, dayEnd] = dayBounds(selection.day)
  return <section className={managerStyles.page} aria-label="Agenda Google">
    <header className={managerStyles.visitorHeader}>
      <Heading level={1}>Agenda Google</Heading>
      <ActionButton variant="secondary" onClick={onBack}>Voltar à agenda de gestão</ActionButton>
    </header>
    {data && <>
      {data.unavailable && <p className="notice" role="status">Google Calendar indisponível. Os últimos horários conhecidos podem estar desatualizados.</p>}
      {!data.connected && <p className="notice" role="status">{data.configured ? 'Liga o Google Calendar para veres aqui os teus eventos.' : 'A ligação ao Google Calendar ainda não está configurada.'}</p>}
      {data.titlesUnavailable && <p className="notice" role="status">{data.needsTitlePermission
        ? 'Autoriza a leitura no Google para veres os eventos e os respetivos títulos.'
        : 'Alguns detalhes do Google Calendar estão indisponíveis.'}</p>}
      {data.configured && (!data.connected || data.needsReconnect || data.needsTitlePermission) && <GoogleCalendarConnectButton
        busy={busy} guard={guard} connected={data.connected} label={data.needsTitlePermission ? 'Autorizar leitura dos títulos no Google' : undefined} />}
    </>}
    <p className={styles.calendarTimezone}>Hora local: Lisboa</p>
    {calendar.loading && <p role="status">A consultar a agenda…</p>}
    {calendar.error && <p className="notice error" role="alert">{calendar.error}</p>}
    <div className={styles.calendarLayout}>
      <AgendaMonthGrid calendar={calendar} selection={selection} onSelect={setSelection}
        hasItems={day => blocksByDay[day]?.length > 0}
        dayStatus="Com registos na agenda" legend="Dias com registos na agenda" />
      <section className={styles.schedule} aria-label="Agenda do dia">
        <p className={styles.eyebrow}>Agenda do dia</p>
        <Heading level={2}>{agendaDay(selection.day)}</Heading>
        {blocks.map(block => {
          const start = Math.max(dayStart, Date.parse(block.startsAt))
          const end = Math.min(dayEnd, Date.parse(block.endsAt))
          const hour = end === dayEnd ? '24:00' : agendaClock(end)
          const source = block.kind === 'Google' ? ['Google Calendar', block.calendar].filter(Boolean).join(' · ') : 'PaCT'
          const open = ['Consultation', 'Event', 'Guest'].includes(block.kind)
          return <AgendaSlotCard key={block.kind + ':' + block.id} startsAt={new Date(start).toISOString()}
            onOpen={open ? () => onOpen({ ...block, sourceId: block.id }) : undefined}>
            <strong>{block.title}</strong>
            <small>{start === dayStart && end === dayEnd ? 'Dia inteiro' : 'Até às ' + hour} · {source}</small>
            {block.overlap && <small>Sobreposição</small>}
          </AgendaSlotCard>
        })}
        {data && blocks.length === 0 && <div className={styles.empty}><AppIcon name="calendar" />
          <Heading level={3}>{data.unavailable ? 'Sem registos conhecidos' : 'Sem registos neste dia'}</Heading>
        </div>}
      </section>
    </div>
  </section>
}
