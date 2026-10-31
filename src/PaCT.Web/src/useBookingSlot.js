import { useCallback, useMemo } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import { dayKey } from './agendaTime'
import { bookableSlots, bookingVariants, validBookingCatalogue } from './clientBookingOptions'

// Both request forms use the choices published for this exact time, never the entire catalogue.
export default function useBookingSlot(startsAt, { enabled = true, publicOnly = false } = {}) {
  const read = useCallback(async signal => {
    const calendar = await apiRequest('consultations/calendar?month=' + dayKey(startsAt).slice(0, 7), undefined, { signal, publicOnly })
    if (!validBookingCatalogue(calendar) || !Array.isArray(calendar.intervals)
      || ![calendar.serverTime, calendar.horizonEndExclusive].every(value => Number.isFinite(Date.parse(value))))
      throw new Error('Não foi possível ler as opções atuais deste horário.')
    return calendar
  }, [startsAt, publicOnly])
  const resource = useLiveResource('agenda', `request-slot:${publicOnly}:${startsAt}`, read, enabled)
  const slot = useMemo(() => resource.data
    ? bookableSlots(resource.data, dayKey(startsAt), bookingVariants(resource.data.services)).find(item => Date.parse(item.startsAt) === Date.parse(startsAt)) || { choices: [] }
    : null, [resource.data, startsAt])
  return { ...resource, slot }
}
