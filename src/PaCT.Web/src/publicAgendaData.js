import { apiRequest } from './identityApi'

// The current public API exposes event details in its paginated catalogue.
export async function readPublicEvent(eventId, serviceId, { signal } = {}) {
  for (let page = 1; page <= 100000; page++) {
    const result = await apiRequest(`consultations/events?serviceId=${encodeURIComponent(serviceId)}&page=${page}`, undefined, { signal })
    if (!Array.isArray(result.items) || !Number.isInteger(result.total) || result.total < 0) throw new Error('Não foi possível ler esta atividade. Atualiza a Agenda.')
    const event = result.items.find(item => item.id === eventId)
    if (event) {
      if (typeof event.serviceId !== 'string' || typeof event.title !== 'string' || ![event.startsAt, event.endsAt].every(value => Number.isFinite(Date.parse(value))) || Date.parse(event.endsAt) <= Date.parse(event.startsAt)) throw new Error('Não foi possível ler os detalhes desta atividade. Atualiza a Agenda.')
      return event
    }
    if (!result.items.length || page * (result.pageSize || 8) >= result.total) break
  }
  throw new Error('Esta atividade já não está publicada. Atualiza a Agenda.')
}

export const durationText = minutes => {
  if (minutes >= 1440) {
    const days = Math.floor(minutes / 1440), rest = minutes % 1440
    return `${days} ${days === 1 ? 'dia' : 'dias'}${rest ? ' e ' + durationText(rest) : ''}`
  }
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return hours ? `${hours}h${rest ? String(rest).padStart(2, '0') : ''}` : `${rest} min`
}
