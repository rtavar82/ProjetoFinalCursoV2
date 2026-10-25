const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export const agendaDate = value => value ? new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'
export const agendaDay = value => new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', dateStyle: 'full' }).format(new Date(instant(value + 'T12:00')))
export const agendaClock = value => new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
export const agendaMoney = value => value == null ? 'Por definir' : new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value)
export const agendaStates = { Available: 'Disponível', Occupied: 'Ocupado', Blocked: 'Bloqueado', Unavailable: 'Sem horário publicado' }
export function localDate(value) {
  const values = parts.formatToParts(value)
  const get = type => values.find(x => x.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}
export function instant(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) throw new Error('Indica a data e hora.')
  const target = Date.parse(value + ':00Z')
  if (!Number.isFinite(target)) throw new Error('Indica uma data e hora válidas.')
  const matches = [-60, 0, 60].map(offset => new Date(target + offset * 60000)).filter(d => localDate(d) === value)
  if (matches.length !== 1) throw new Error('Esta hora de Lisboa é ambígua ou inexistente devido à mudança de hora. Escolhe outra hora.')
  return matches[0].toISOString()
}
export const dayKey = value => localDate(new Date(value)).slice(0, 10)
export function addDays(day, count) { const value = new Date(day + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + count); return value.toISOString().slice(0, 10) }
export function shiftMonth(month, count) { const value = new Date(month + '-01T12:00:00Z'); value.setUTCMonth(value.getUTCMonth() + count); return value.toISOString().slice(0, 7) }
export function monthDays(month) {
  const next = shiftMonth(month, 1) + '-01'
  const days = []
  for (let day = month + '-01'; day < next; day = addDays(day, 1)) days.push(day)
  return days
}
export function dayIntervals(calendar, day) {
  const start = Date.parse(instant(day + 'T00:00')), end = Date.parse(instant(addDays(day, 1) + 'T00:00'))
  return (calendar?.intervals || []).filter(x => Date.parse(x.startsAt) < end && Date.parse(x.endsAt) > start)
    .map(x => ({ state: x.state, startsAt: new Date(Math.max(start, Date.parse(x.startsAt))).toISOString(), endsAt: new Date(Math.min(end, Date.parse(x.endsAt))).toISOString() }))
}
export function servicePrice(service) { return service.paymentMode === 'Free' ? 'Gratuita' : service.paymentMode === 'Contribution' ? 'Contribuição livre' : service.definedPerEvent && service.referencePrice == null ? 'Valor definido na ocorrência' : agendaMoney(service.referencePrice) }
export function availableStarts(calendar, day, service) {
  if (!calendar || !service) return []
  const now = Date.parse(calendar.serverTime), horizon = Date.parse(calendar.horizonEndExclusive)
  const duration = service.durationMinutes * 60000
  const slots = new Set()
  const checks = calendar.bookingIntervals || calendar.intervals
  if (Array.isArray(calendar.bookingWindows)) {
    const dayStart = Date.parse(instant(day + 'T00:00')), dayEnd = Date.parse(instant(addDays(day, 1) + 'T00:00'))
    for (const window of calendar.bookingWindows) {
      const rule = window.rules
      if (rule && ((rule.serviceId && rule.serviceId !== service.id) || (rule.modality && rule.modality !== service.modality)
        || (rule.publicLocation && rule.publicLocation !== service.publicLocation))) continue
      const first = Date.parse(window.startsAt), end = Date.parse(window.endsAt)
      if (first >= dayEnd || end <= dayStart) continue
      const origin = Date.parse(rule?.firstStartAt || window.startsAt)
      const lower = Math.max(first, dayStart, now + 1)
      const upper = Math.min(rule ? Date.parse(rule.lastStartAt) : end - duration, dayEnd - 1, horizon - 1)
      const candidates = rule ? [] : [Math.ceil(lower / 60000) * 60000]
      for (let at = rule ? origin + Math.max(0, Math.ceil((lower - origin) / 1800000)) * 1800000 : Math.ceil(lower / 1800000) * 1800000; at <= upper; at += 1800000) candidates.push(at)
      for (const at of candidates) {
        if (at > upper || at <= now || !rule && !checks.some(x => x.state === 'Available' && Date.parse(x.startsAt) <= at && Date.parse(x.endsAt) >= at + duration)) continue
        if (checks.some(x => ['Occupied', 'Blocked'].includes(x.state) && Date.parse(x.startsAt) < at + duration + 1800000 && Date.parse(x.endsAt) > at)) continue
        try { if (Date.parse(instant(localDate(new Date(at)))) === at) slots.add(new Date(at).toISOString()) } catch { /* Never silently pick one occurrence of a repeated Lisbon time. */ }
      }
    }
    return [...slots].sort()
  }
  for (const interval of dayIntervals(calendar, day).filter(x => x.state === 'Available')) {
    const start = Date.parse(interval.startsAt)
    const candidates = [Math.ceil(start / 60000) * 60000]
    for (let at = Math.ceil(start / 1800000) * 1800000; at < Date.parse(interval.endsAt); at += 1800000) candidates.push(at)
    for (const at of candidates) {
      if (at <= now || at >= horizon) continue
      const containing = calendar.intervals.find(x => x.state === 'Available' && Date.parse(x.startsAt) <= at && Date.parse(x.endsAt) >= at + duration)
      if (!containing) continue
      if (calendar.intervals.some(x => ['Occupied', 'Blocked'].includes(x.state) && Date.parse(x.startsAt) < at + duration + 1800000 && Date.parse(x.endsAt) > at)) continue
      try { if (Date.parse(instant(localDate(new Date(at)))) === at) slots.add(new Date(at).toISOString()) } catch { /* Do not suggest an ambiguous local time. */ }
    }
  }
  return [...slots].sort()
}
