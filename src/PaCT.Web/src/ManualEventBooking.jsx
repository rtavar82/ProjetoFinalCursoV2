import AdaptiveSelect from './AdaptiveSelect'
import EventCapacityConsent from './EventCapacityConsent'
import { useCallback, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import Pagination from './Pagination'
import { agendaDate, servicePrice } from './agendaTime'
import styles from './ManagerScheduling.module.css'

export default function ManualEventBooking({ service, person, disabled, publish, onBack, onSaved, onWorking, onReviewStart, seed }) {
  const seedEventId = seed?.serviceId === service.id ? seed.eventId || '' : ''
  const [page, setPage] = useState(1), [eventId, setEventId] = useState(seedEventId), [choice, setChoice] = useState('Confirmed')
  const [overcapacity, setOvercapacity] = useState(false)
  const [review, setReview] = useState(null), [checking, setChecking] = useState(false), [error, setError] = useState('')
  const read = useCallback(async signal => {
    const list = await apiRequest(`consultations/events?serviceId=${encodeURIComponent(service.id)}&page=${page}`, undefined, { signal })
    if (seedEventId && page === 1 && !list.items.some(item => item.id === seedEventId)) {
      const detail = await apiRequest(`consultations/events/${seedEventId}`, undefined, { signal })
      list.items = [detail.summary, ...list.items]
    }
    return { ...list, observedAt: Date.now() }
  }, [service.id, page, seedEventId])
  const events = useLiveResource('events', `manual:${service.id}:${page}:${seed?.eventId || ''}`, read)
  async function preview(event) {
    event.preventDefault(); setError('')
    if (!person) { setError('Pesquisa e seleciona a ficha do cliente.'); return }
    setChecking(true); onWorking?.(true); onReviewStart?.()
    try {
      const current = (await apiRequest(`consultations/events/${eventId}`)).summary
      if (current.serviceId !== service.id || current.state !== 'Waiting' || Date.parse(current.startsAt) <= Date.now()) throw new Error('Escolhe uma ocorrência futura disponível.')
      setOvercapacity(false); setReview({ event: current, personId: person.id, choice })
    } catch (failure) { setError(failure.message) }
    finally { setChecking(false); onWorking?.(false) }
  }
  return <div data-card-id="manual-event-booking">
    {(error || events.error) && <p className="notice error" role="alert">{error || events.error}</p>}
    {events.loading && <p role="status">A consultar as datas…</p>}
    {!review ? <form data-protect-draft onSubmit={preview}><fieldset className={styles.fields} disabled={disabled || checking}>
      <label>Data do grupo ou retiro<AdaptiveSelect aria-label="Data do grupo ou retiro" required value={eventId} onChange={event => setEventId(event.target.value)}><option value="">Escolhe a ocorrência</option>{events.data?.items.filter(item => item.registrationOpen !== false && item.state === 'Waiting' && Date.parse(item.startsAt) > events.data.observedAt).map(item => <option key={item.id} value={item.id}>{agendaDate(item.startsAt)} · {item.publicLocation} · {item.remaining} vagas</option>)}</AdaptiveSelect></label>
      {events.data?.total === 0 && <p>Não há datas criadas para esta atividade. Define uma ocorrência em Construir e editar agenda.</p>}
      <Pagination total={events.data?.total} page={page} onChange={next => { setPage(next); setEventId('') }} />
      <label>Inscrição<AdaptiveSelect aria-label="Estado da inscrição" value={choice} onChange={event => setChoice(event.target.value)}><option value="Confirmed">Confirmada</option><option value="Waiting">Em espera</option></AdaptiveSelect></label>
      <div className={styles.actions}><button type="button" className="secondary" onClick={onBack}>Voltar à agenda</button><button disabled={!eventId || !person || checking}>Rever antes de validar</button></div>
    </fieldset></form> : <>
      <section className={styles.summary} aria-label="Rever inscrição"><h3>Rever inscrição</h3><p>{person?.data.firstName} {person?.data.lastName}</p><p>{review.event.title}</p><p>{agendaDate(review.event.startsAt)} — {agendaDate(review.event.endsAt)}</p><p>{review.event.publicLocation} · {servicePrice({ ...review.event, referencePrice: review.event.totalPrice ?? review.event.referencePrice })}</p><p>{review.choice === 'Waiting' ? 'Inscrição em espera.' : 'Inscrição confirmada; a confirmação não regista um pagamento.'}</p></section>
      {review.choice === 'Confirmed' && <EventCapacityConsent event={review.event} disabled={disabled} checked={overcapacity} onChange={setOvercapacity} />}
      <div className={styles.actions}><button type="button" className="secondary" disabled={disabled} onClick={() => setReview(null)}>Voltar à edição</button><button type="button" disabled={disabled || person?.id !== review.personId || review.choice === 'Confirmed' && review.event.remaining === 0 && !overcapacity} onClick={() => publish({ action: 'JoinEvent', id: review.event.id, version: review.event.version, personId: review.personId, choice: review.choice, confirmOvercapacity: overcapacity }, onSaved, () => setReview(null))}>Confirmar inscrição</button></div>
    </>}
  </div>
}
