// Search stored publication fields, never the choices that a free block could allow.
export function hasAgendaSearch({ serviceId, type, place, modality } = {}) {
  return !!(serviceId || type || place || modality)
}

export function searchPublishedAgenda(calendar, filters = {}) {
  if (!calendar || !hasAgendaSearch(filters)) return calendar
  const { serviceId, type, place, modality } = filters
  const matches = (fields, title) => !!fields
    && (!serviceId || fields.serviceId === serviceId)
    && (!type || title === type || calendar.services?.some(service => service.id === fields.serviceId && service.title === type))
    && (!place || fields.publicLocation === place)
    && (!modality || fields.modality === modality)
  const windows = (calendar.bookingWindows || []).filter(window => matches(window.rules))
  const segments = (calendar.intervals || []).flatMap(segment => windows.flatMap(window => {
    const start = Math.max(Date.parse(segment.startsAt), Date.parse(window.startsAt))
    const end = Math.min(Date.parse(segment.endsAt), Date.parse(window.endsAt))
    return start < end ? [{ ...segment, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() }] : []
  }))
  return { ...calendar,
    bookingWindows: windows,
    // Keep all occupied/blocked segments when checking whether a consultation fits.
    bookingIntervals: calendar.bookingIntervals || calendar.intervals || [],
    intervals: [...new Map(segments.map(segment => [segment.state + ':' + segment.startsAt + ':' + segment.endsAt, segment])).values()],
    events: (calendar.events || []).filter(event => matches(event, event.title)),
  }
}
