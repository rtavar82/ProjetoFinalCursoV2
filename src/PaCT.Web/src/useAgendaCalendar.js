import { useCallback, useState } from 'react'
import useLiveResource from './useLiveResource'
import { calendarSelection, readAgendaCalendar } from './agendaCalendarData'

export default function useAgendaCalendar({ enabled = true, publicOnly = false } = {}) {
  const [preferred, setSelection] = useState(null)
  const month = preferred?.month || ''
  const read = useCallback(signal => readAgendaCalendar(month, { signal, publicOnly }), [month, publicOnly])
  const calendar = useLiveResource('agenda', `calendar:${publicOnly ? 'public' : 'account'}:${month || 'current'}`, read, enabled)
  return { calendar, selection: calendarSelection(preferred, calendar.data), setSelection }
}
