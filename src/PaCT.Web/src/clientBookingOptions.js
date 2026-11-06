import { availableStarts, dayKey } from './agendaTime.js'

export const canBookForClient = person => person.isActive !== false && person.identityReviewStatus !== 'Pending'

export function validBookingCatalogue(value) {
  return Array.isArray(value?.services) && value.services.every(s => typeof s.id === 'string' && typeof s.title === 'string'
    && Number.isInteger(s.durationMinutes) && (s.definedPerEvent && ['Group', 'Retreat'].includes(s.serviceKind) ? s.durationMinutes === 0 : s.durationMinutes >= 15 && s.durationMinutes <= 720)
    && (s.bookingOptions == null || Array.isArray(s.bookingOptions) && s.bookingOptions.every(o => typeof o.id === 'string' && ['InPerson', 'Remote'].includes(o.modality))))
}

export function physicalLocations(setup) {
  return setup?.physicalLocations ?? [...new Set([
    ...bookingVariants(setup?.services).filter(option => option.modality === 'InPerson').map(option => option.publicLocation),
    ...(setup?.services ?? []).filter(service => service.serviceKind && service.modality === 'InPerson').map(service => service.publicLocation)
  ].filter(Boolean))]
}

export function bookingVariants(services = []) {
  return services.filter(service => !service.serviceKind && service.active !== false).flatMap(service => (service.bookingOptions || [{ id: 'standard', modality: service.modality, publicLocation: service.publicLocation }]).map(option => {
    const paymentMode = option.paymentMode || service.paymentMode
    return {
      ...service, ...option, id: service.id, optionId: option.id, version: service.version || 1,
      durationMinutes: option.durationMinutes ?? service.durationMinutes,
      referencePrice: paymentMode === 'Free' ? 0 : paymentMode === 'Contribution' ? null : option.referencePrice ?? service.referencePrice,
      paymentMode, publicLocation: option.modality === 'Remote' ? '' : option.publicLocation,
    }
  }))
}
export const variantKey = value => value ? `${value.id}:${value.optionId}` : ''
export function bookableSlots(calendar, day, variants) {
  const starts = new Map()
  const windows = Array.isArray(calendar?.bookingWindows) ? calendar.bookingWindows : [null]
  for (const variant of variants) for (const window of windows) {
    const source = window ? { ...calendar, bookingWindows: [window] } : calendar
    for (const start of availableStarts(source, day, variant)) {
      if (!starts.has(start)) starts.set(start, { choices: new Map(), publications: new Map(), windowIds: new Set() })
      const slot = starts.get(start)
      slot.choices.set(variantKey(variant), variant)
      if (window?.id) slot.windowIds.add(window.id)
      const fields = { serviceId: window?.rules?.serviceId || null, modality: window?.rules?.modality || null,
        publicLocation: window?.rules?.publicLocation || null, audience: window?.rules?.audience || 'All' }
      slot.publications.set(JSON.stringify(fields), fields)
    }
  }
  return [...starts].sort(([a], [b]) => a.localeCompare(b)).map(([startsAt, slot]) => ({ startsAt, choices: [...slot.choices.values()], publications: [...slot.publications.values()], windowIds: [...slot.windowIds].sort() }))
}

export function findBookingSlot(calendar, startsAt, windowId) {
  const source = windowId ? { ...calendar, bookingWindows: (calendar.bookingWindows || []).filter(window => window.id === windowId) } : calendar
  return bookableSlots(source, dayKey(startsAt), bookingVariants(calendar.services)).find(item => Date.parse(item.startsAt) === Date.parse(startsAt))
}

export function publishedSlotDetails(slot, services) {
  const publications = slot.publications || []
  const fixedValues = (field, sources = publications) => sources.length && sources.every(source => source[field]) ? [...new Set(sources.map(source => source[field]))] : []
  const serviceIds = fixedValues('serviceId')
  const titles = [...new Set(serviceIds.map(id => services.find(service => service.id === id)?.title).filter(Boolean))]
  const modes = fixedValues('modality')
  const remote = modes.length === 1 && modes[0] === 'Remote'
  const places = fixedValues('publicLocation', publications.filter(source => source.modality !== 'Remote'))
  return {
    title: titles.length ? titles.join(' ou ') : 'Horário livre',
    modality: modes.length === 1 ? remote ? 'Remota' : 'Presencial' : 'Modalidade à escolha',
    location: remote ? '' : places.length ? places.join(' ou ') : 'Local à escolha',
    registeredOnly: publications.length > 0 && publications.every(source => source.audience === 'Registered'),
  }
}
