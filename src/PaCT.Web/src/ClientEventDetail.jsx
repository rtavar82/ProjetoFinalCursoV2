import { useCallback } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import ConsultationDialog from './ConsultationDialog'
import { Participation } from './GroupEventsPanel'
import { agendaDate } from './agendaTime'

export default function ClientEventDetail({ entry, send, disabled, feedback, guard, onClose }) {
  const read = useCallback(signal => apiRequest('consultations/events/' + entry.sourceId, undefined, { signal }), [entry.sourceId])
  const resource = useLiveResource('events', 'client-participation:' + entry.sourceId, read)
  const detail = resource.data
  const participation = detail?.ownParticipations.find(p => p.id === entry.id)
  async function command(input) {
    const result = await send(input)
    if (result) resource.refresh()
    return result
  }
  return <ConsultationDialog label="Detalhe da inscrição" disabled={disabled} onClose={() => guard(onClose)}>
    <h2>{detail?.summary.title || entry.serviceTitle}</h2>{feedback}
    {resource.loading && <p role="status">A consultar a inscrição…</p>}
    {resource.error && <div className="notice error" role="alert"><p>{resource.error}</p><button className="secondary" disabled={disabled} onClick={resource.refresh}>Voltar a tentar</button></div>}
    {detail && <><p>{detail.summary.kind === 'Retreat' ? 'Retiro' : 'Grupo'}</p><p>{agendaDate(detail.summary.startsAt)} — {agendaDate(detail.summary.endsAt)}</p><p>{detail.summary.publicLocation}</p>
      {detail.instructions && <p className="shared-consultation-note">{detail.instructions}</p>}
      {participation ? <Participation participation={participation} event={detail} disabled={disabled || resource.refreshing} send={command} />
        : <p role="alert">Não foi possível encontrar a tua inscrição nesta ocorrência.</p>}
    </>}
  </ConsultationDialog>
}
