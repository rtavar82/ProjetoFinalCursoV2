import { useCallback, useState } from 'react'
import useLiveResource from './useLiveResource'
import { calendarSelection, readAgendaCalendar } from './agendaCalendarData'

export default function useAgendaCalendar({ enabled = true, publicOnly = false, readCalendar = readAgendaCalendar, resourceKey = 'calendar' } = {}) {
  const [preferred, setSelection] = useState(null)
  const month = preferred?.month || ''
  const read = useCallback(signal => readCalendar(month, { signal, publicOnly }), [readCalendar, month, publicOnly])
  const calendar = useLiveResource('agenda', `${resourceKey}:${publicOnly ? 'public' : 'account'}:${month || 'current'}`, read, enabled)
  return { calendar, selection: calendarSelection(preferred, calendar.data), setSelection }
}
