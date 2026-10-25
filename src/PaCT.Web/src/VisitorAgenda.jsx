import { useEffect, useState } from 'react'
import ClientCalendar from './ClientCalendar'
import GuestBookingForm from './GuestBookingForm'
import ConsultationDialog from './ConsultationDialog'
import { readPublicEvent } from './publicAgendaData'
import styles from './VisitorAgenda.module.css'

function EventRequest({ target, onClose, onSignIn, onBrowseService }) {
  const [event, setEvent] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    const controller = new AbortController()
    readPublicEvent(target.id, target.serviceId, { signal: controller.signal }).then(value => { if (current) { setEvent(value); setError('') } }).catch(failure => { if (current) setError(failure.message) })
    return () => { current = false; controller.abort() }
  }, [target, retry])
  if (!event) return <ConsultationDialog compact label="O teu pedido" onClose={onClose}><h2>O teu pedido</h2>{error ? <><p className="notice error" role="alert">{error}</p><button type="button" onClick={() => { setError(''); setRetry(value => value + 1) }}>Tentar novamente</button></> : <p role="status">A consultar a atividade…</p>}</ConsultationDialog>
  const service = { id: event.serviceId, title: event.title, modality: 'InPerson', publicLocation: event.publicLocation, durationMinutes: Math.round((Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60000),
    referencePrice: event.isFree ? 0 : event.totalPrice ?? event.referencePrice, paymentMode: event.isFree ? 'Free' : event.paymentMode }
  return <GuestBookingForm selection={{ services: target.services, eventId: event.id, startsAt: event.startsAt, endsAt: event.endsAt, service, event }} onBack={onClose} onSignIn={onSignIn} onBrowseService={onBrowseService} />
}

export default function VisitorAgenda({ initialServiceId = '', selection, onChoose, onBack, onSignIn, authenticated = false }) {
  const [event, setEvent] = useState(null), [browseService, setBrowseService] = useState(initialServiceId)
  function browse(id) { onBack(); setEvent(null); setBrowseService(id) }
  return <section className={styles.page} aria-label="Agenda do visitante">
    <p className="eyebrow">A TUA AGENDA</p><h1>Um tempo para ti.</h1><p>Escolhe o dia. Encontra o teu horário.</p>
    {authenticated && <p>Com sessão iniciada, faz o agendamento na tua área com a tua ficha.</p>}
    <ClientCalendar key={browseService} visitor initialServiceId={browseService} onChoose={onChoose} onEvent={(_, item) => authenticated ? onChoose(item) : setEvent(item)} />
    {selection && <GuestBookingForm key={selection.startsAt} selection={selection} onBack={onBack} onSignIn={onSignIn} onBrowseService={browse} />}
    {event && <EventRequest target={event} onClose={() => setEvent(null)} onSignIn={onSignIn} onBrowseService={browse} />}
  </section>
}
