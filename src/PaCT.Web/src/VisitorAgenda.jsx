import { useCallback, useState } from 'react'
import ClientCalendar from './ClientCalendar'
import GuestBookingForm from './GuestBookingForm'
import ConsultationDialog from './ConsultationDialog'
import { readPublicEvent } from './publicAgendaData'
import styles from './VisitorAgenda.module.css'
import useLiveResource from './useLiveResource'

function EventRequest({ target, onClose, onSignIn, previewOnly = false }) {
  const read = useCallback(() => readPublicEvent(target.id, target.serviceId, { publicOnly: previewOnly }), [target.id, target.serviceId, previewOnly])
  const { data: event, error, refresh } = useLiveResource('events', 'visitor-event:' + target.id, read)
  if (!event) return <ConsultationDialog compact label="O teu pedido" onClose={onClose}><h2>O teu pedido</h2>{error ? <><p className="notice error" role="alert">{error}</p><button type="button" onClick={refresh}>Tentar novamente</button></> : <p role="status">A consultar a atividade…</p>}</ConsultationDialog>
  const service = { id: event.serviceId, title: event.title, modality: 'InPerson', publicLocation: event.publicLocation, durationMinutes: Math.round((Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60000),
    referencePrice: event.isFree ? 0 : event.totalPrice ?? event.referencePrice, paymentMode: event.isFree ? 'Free' : event.paymentMode }
  return <GuestBookingForm selection={{ eventId: event.id, startsAt: event.startsAt, endsAt: event.endsAt, service, event }} onBack={onClose} onSignIn={onSignIn} previewOnly={previewOnly} />
}

export default function VisitorAgenda({ initialServiceId = '', selection, onChoose, onBack, onSignIn, authenticated = false, previewOnly = false }) {
  const [event, setEvent] = useState(null)
  return <section className={styles.page} aria-label="Agenda do visitante">
    <p className="eyebrow">A TUA AGENDA</p><h1>Um tempo para ti.</h1><p>Escolhe o dia. Encontra o teu horário.</p>
    {authenticated && <p>Com sessão iniciada, faz o agendamento na tua área com a tua ficha.</p>}
    <ClientCalendar key={initialServiceId} visitor publicOnly={previewOnly} initialServiceId={initialServiceId} onChoose={onChoose} onEvent={(_, item) => authenticated ? onChoose(item) : setEvent(item)} />
    {selection && <GuestBookingForm key={selection.startsAt} selection={selection} onBack={onBack} onSignIn={onSignIn} previewOnly={previewOnly} />}
    {event && <EventRequest target={event} onClose={() => setEvent(null)} onSignIn={onSignIn} previewOnly={previewOnly} />}
  </section>
}
