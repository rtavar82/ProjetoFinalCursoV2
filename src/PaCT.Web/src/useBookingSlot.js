import { useCallback, useMemo } from 'react'
import { readAgendaCalendar } from './agendaCalendarData'
import useLiveResource from './useLiveResource'
import { dayKey } from './agendaTime'
import { findBookingSlot } from './clientBookingOptions'

// Both request forms use the choices published for this exact time, never the entire catalogue.
export default function useBookingSlot(startsAt, { enabled = true, publicOnly = false, windowId } = {}) {
  const read = useCallback(signal => readAgendaCalendar(dayKey(startsAt).slice(0, 7), { signal, publicOnly }), [startsAt, publicOnly])
  const resource = useLiveResource('agenda', `request-slot:${publicOnly}:${startsAt}`, read, enabled)
  const slot = useMemo(() => resource.data
    ? findBookingSlot(resource.data, startsAt, windowId) || { choices: [] }
    : null, [resource.data, startsAt, windowId])
  return { ...resource, slot }
}
