import { useCallback, useMemo } from 'react'
import { readAgendaCalendar } from './agendaCalendarData'
import useLiveResource from './useLiveResource'
import { dayKey } from './agendaTime'
import { bookableSlots, bookingVariants } from './clientBookingOptions'

// Both request forms use the choices published for this exact time, never the entire catalogue.
export default function useBookingSlot(startsAt, { enabled = true, publicOnly = false } = {}) {
  const read = useCallback(signal => readAgendaCalendar(dayKey(startsAt).slice(0, 7), { signal, publicOnly }), [startsAt, publicOnly])
  const resource = useLiveResource('agenda', `request-slot:${publicOnly}:${startsAt}`, read, enabled)
  const slot = useMemo(() => resource.data
    ? bookableSlots(resource.data, dayKey(startsAt), bookingVariants(resource.data.services)).find(item => Date.parse(item.startsAt) === Date.parse(startsAt)) || { choices: [] }
    : null, [resource.data, startsAt])
  return { ...resource, slot }
}
