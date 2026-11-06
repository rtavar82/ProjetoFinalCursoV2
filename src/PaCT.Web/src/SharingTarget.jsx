import { useEffect, useState } from 'react'
import ConsultationDialog from './ConsultationDialog'
import ClientBookingDialog from './ClientBookingDialog'
import GuestBookingForm from './GuestBookingForm'
import GroupEventsPanel from './GroupEventsPanel'
import { EventRequest } from './VisitorAgenda'
import { apiRequest } from './identityApi'
import { isManager } from './identityRoles'
import { showSuccess } from './actionNotices'
import { readSharingTarget } from './sharingData'
import { readAgendaCalendar } from './agendaCalendarData'
import { findBookingSlot } from './clientBookingOptions'
import { dayKey } from './agendaTime'

export default function SharingTarget({ reference, profile, onClose, onSignIn, guard }) {
  const [view, setView] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    const options = { signal: controller.signal }
    async function open() {
      const target = await readSharingTarget(reference, options)
      if (target.kind === 'event') return { target }
      const calendar = await readAgendaCalendar(dayKey(target.startsAt).slice(0, 7), options)
      const slot = findBookingSlot(calendar, target.startsAt, target.windowId)
      if (!slot?.choices.length) throw new Error('Horário indisponível.')
      return { target, slot: { ...slot, windowId: target.windowId } }
    }
    open().then(result => { if (!controller.signal.aborted) setView(result) })
      .catch(error => { if (!controller.signal.aborted) setView({ error: error.message }) })
    return () => controller.abort()
  }, [reference])
  if (!view || view.error) return <ConsultationDialog title="Agenda" onClose={onClose}>
    {view?.error ? <p role="alert" className="notice error">{view.error}</p> : <p role="status">A abrir a Agenda…</p>}
  </ConsultationDialog>
  return <AgendaTarget view={view} profile={profile} onClose={onClose} onSignIn={onSignIn} guard={guard} />
}

function AgendaTarget({ view, profile, onClose, onSignIn, guard }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [id] = useState(() => crypto.randomUUID())
  const manager = isManager(profile?.role)
  async function send(command) {
    setBusy(true); setError('')
    try {
      const result = await apiRequest('consultations/commands', command)
      if (!result.id) throw new Error('O pedido ficou sem confirmação.')
      return result
    } catch (failure) { setError(failure.message); throw failure }
    finally { setBusy(false) }
  }

  if (view.target.kind === 'event') {
    const event = { id: view.target.eventId, serviceId: view.target.serviceId }
    if (!profile) return <EventRequest target={event} onClose={onClose} onSignIn={onSignIn} />
    return <GroupEventsPanel manager={manager} send={command => send(command).catch(() => null)} disabled={busy}
      guard={guard} feedback={error && <p role="alert" className="notice error">{error}</p>}
      initialEntry={{ events: true, id: event.id }} onClose={onClose} />
  }
  if (!profile || manager) return <GuestBookingForm selection={view.slot} onBack={onClose} onSignIn={onSignIn} previewOnly={manager} />
  return <ClientBookingDialog seed={{ id, ...view.slot }} send={send} disabled={busy} guard={guard}
    onClose={onClose} onConfirmed={() => { showSuccess('Pedido de marcação enviado.'); onClose() }} />
}