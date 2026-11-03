// Presentation follows the viewer; persisted event/participation states stay distinct.
export default function eventStatusLabel(event, { manager = false, participation, participations = [] } = {}) {
  const active = item => ['Confirmed', 'Requested', 'Waiting'].includes(item.state)
  const current = participation || [...participations].sort((a, b) => Number(active(b)) - Number(active(a))
    || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))[0]
  if (manager) return current?.process?.processLabel || event.process?.processLabel
  if (current?.process?.processLabel) return current.state === 'Waiting'
    ? current.process.processLabel.replace(/em espera/i, 'na fila de desistências')
    : current.process.processLabel
  if (event.state === 'Cancelled') return event.process?.processLabel
  if (event.state === 'Performed') return event.kind === 'Retreat' ? 'Retiro realizado' : 'Grupo realizado'
  if (event.hasParticipation) return 'Tens uma inscrição neste evento'
  return event.registrationOpen ? event.remaining > 0 ? 'Inscrições abertas' : 'Inscrições completas' : 'Inscrições encerradas'
}
