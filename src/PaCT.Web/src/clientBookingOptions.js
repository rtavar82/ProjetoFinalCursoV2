import { availableStarts } from './agendaTime'

export function validBookingCatalogue(value) {
  return Array.isArray(value?.services) && value.services.every(s => typeof s.id === 'string' && typeof s.title === 'string'
    && Number.isInteger(s.durationMinutes) && (s.definedPerEvent && ['Group', 'Retreat'].includes(s.serviceKind) ? s.durationMinutes === 0 : s.durationMinutes >= 15 && s.durationMinutes <= 720)
    && (s.bookingOptions == null || Array.isArray(s.bookingOptions) && s.bookingOptions.every(o => typeof o.id === 'string' && ['InPerson', 'Remote'].includes(o.modality))))
}

export function bookingVariants(services = []) {
  return services.filter(service => !service.serviceKind).flatMap(service => (service.bookingOptions || [{ id: 'standard', modality: service.modality, publicLocation: service.publicLocation }]).map(option => ({
    ...service, ...option, id: service.id, optionId: option.id, version: service.version || 1,
    durationMinutes: option.durationMinutes ?? service.durationMinutes, referencePrice: option.referencePrice === undefined ? service.referencePrice : option.referencePrice,
    paymentMode: option.paymentMode || service.paymentMode, publicLocation: option.modality === 'Remote' ? '' : option.publicLocation,
  })))
}
export const variantKey = value => value ? `${value.id}:${value.optionId}` : ''
export function bookableSlots(calendar, day, variants) {
  const starts = new Map()
  for (const variant of variants) for (const start of availableStarts(calendar, day, variant)) {
    if (!starts.has(start)) starts.set(start, [])
    starts.get(start).push(variant)
  }
  return [...starts].sort(([a], [b]) => a.localeCompare(b)).map(([startsAt, choices]) => ({ startsAt, choices }))
}
