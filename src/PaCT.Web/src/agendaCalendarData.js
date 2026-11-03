import { apiRequest } from './identityApi'
import { dayKey } from './agendaTime'
import { validBookingCatalogue } from './clientBookingOptions'

export async function readAgendaCalendar(requestedMonth, options = {}) {
  async function read(month) {
    const value = await apiRequest('consultations/calendar' + (month ? '?month=' + month : ''), undefined, options)
    if (!validBookingCatalogue(value) || value.timeZone !== 'Europe/Lisbon' || !Array.isArray(value.intervals)
      || ![value.serverTime, value.startsAt, value.endsAt, value.horizonEndExclusive].every(v => Number.isFinite(Date.parse(v)))
      || value.events != null && (!Array.isArray(value.events) || value.events.some(e => !Number.isFinite(Date.parse(e.startsAt)) || !Number.isFinite(Date.parse(e.endsAt)))))
      throw new Error('Não foi possível ler a agenda. Tenta novamente.')
    return value
  }
  // The server determines today's month before an old window or a device clock
  // can request a month that has already left the booking horizon.
  const current = await read()
  const firstMonth = dayKey(current.serverTime).slice(0, 7)
  const lastMonth = dayKey(new Date(Date.parse(current.horizonEndExclusive) - 1)).slice(0, 7)
  return requestedMonth && requestedMonth > firstMonth && requestedMonth <= lastMonth
    ? read(requestedMonth) : current
}

export function calendarSelection(preferred, calendar) {
  if (!calendar) {
    const day = dayKey(new Date())
    return preferred || { month: day.slice(0, 7), day }
  }
  const firstDay = dayKey(calendar.serverTime)
  const lastDay = dayKey(new Date(Date.parse(calendar.horizonEndExclusive) - 1))
  const month = dayKey(calendar.startsAt).slice(0, 7)
  const day = preferred?.day
  return { month, day: day?.startsWith(month + '-') && day >= firstDay && day <= lastDay
    ? day : month === firstDay.slice(0, 7) ? firstDay : month + '-01' }
}
