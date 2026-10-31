import AdaptiveSelect from './AdaptiveSelect'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import ConsultationDialog from './ConsultationDialog'
import PhoneFields from './PhoneFields'
import AppIcon from './AppIcon'
import { agendaClock, dayKey, servicePrice } from './agendaTime'
import { bookingVariants, bookableSlots, variantKey, validBookingCatalogue } from './clientBookingOptions'
import { durationText, readPublicEvent } from './publicAgendaData'
import { individualRequestNotice } from './bookingRequestNotice'
import styles from './VisitorAgenda.module.css'
import useBookingSlot from './useBookingSlot'

const signature = choice => JSON.stringify([variantKey(choice), choice.version, choice.modality, choice.publicLocation, choice.durationMinutes, choice.referencePrice, choice.paymentMode])
const bookingDate = value => new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', dateStyle: 'long' }).format(new Date(value))
const bookingDates = (start, end) => dayKey(start) === dayKey(end) ? bookingDate(start) : `${bookingDate(start)} — ${bookingDate(end)}`

export default function GuestBookingForm({ selection, onBack, onSignIn, previewOnly = false }) {
  const seedChoices = useMemo(() => selection.choices || [{ ...selection.service, id: selection.serviceId || selection.service.id, version: selection.serviceVersion || selection.service.version || 1, optionId: selection.deliveryOptionId || 'standard' }], [selection])
  const currentSlot = useBookingSlot(selection.startsAt, { enabled: !selection.eventId, publicOnly: previewOnly })
  const choices = currentSlot.slot?.choices || seedChoices
  const [selected, setSelected] = useState(seedChoices[0]), [review, setReview] = useState(null)
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false), [error, setError] = useState(''), [receipt, setReceipt] = useState(null), [uncertain, setUncertain] = useState(false)
  const pending = useRef(null), dirty = useRef(false), activeWrite = useRef(false), reviewHeading = useRef(null)
  useEffect(() => {
    if (!currentSlot.slot) return
    const update = window.setTimeout(() => {
      if (!dirty.current && !pending.current) setSelected(previous => choices.find(choice => variantKey(choice) === variantKey(previous)) || choices[0] || previous)
    }, 0)
    return () => window.clearTimeout(update)
  }, [currentSlot.slot, choices])
  const event = selection.event
  const stale = !selection.eventId && !!currentSlot.slot && !choices.some(choice => signature(choice) === signature(selected))
  function chooseType(id) {
    if (id === selected.id) return
    const available = !selection.eventId && choices.find(choice => choice.id === id)
    if (available) choose(available)
  }
  const modes = [...new Set(choices.filter(choice => choice.id === selected?.id).map(choice => choice.modality))]
  const alternatives = choices.filter(choice => choice.id === selected?.id && choice.modality === selected?.modality)
  const endsAt = selection.endsAt || new Date(Date.parse(selection.startsAt) + selected.durationMinutes * 60000).toISOString()
  const eventClosed = !!event && (event.state !== 'Scheduled' || event.remaining <= 0 || event.restricted)
  useEffect(() => {
    function leaving(e) { if (dirty.current || pending.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', leaving)
    return () => window.removeEventListener('beforeunload', leaving)
  }, [])
  useEffect(() => {
    reviewHeading.current?.focus()
    reviewHeading.current?.closest('dialog')?.scrollTo({ top: 0 })
  }, [review, receipt])
  function choose(choice) { if (choice) { setSelected(choice); setReview(null); setError(''); dirty.current = true } }
  function back() { if (!busy && !checking && !uncertain && (!dirty.current || window.confirm('Queres voltar à agenda e descartar o preenchimento?'))) onBack() }
  async function preview(e) {
    e.preventDefault(); if (checking || busy || uncertain || stale || !selected) return
    const fields = Object.fromEntries(new FormData(e.currentTarget))
    if (!fields.firstName.trim() || !fields.lastName.trim()) { setError('Preenche o primeiro e o último nome.'); return }
    if (!fields.locality?.trim()) { setError('Preenche a localidade.'); return }
    setChecking(true); setError('')
    try {
      if (selection.eventId) {
        const current = await readPublicEvent(selection.eventId, selected.id, { publicOnly: previewOnly })
        if (current.state !== 'Scheduled' || current.remaining <= 0 || current.restricted || Date.parse(current.startsAt) !== Date.parse(selection.startsAt) || event && current.version !== event.version)
          throw new Error('Esta atividade mudou ou já não permite pedidos. Atualiza a Agenda antes de continuar.')
      } else {
        const calendar = await apiRequest('consultations/calendar?month=' + dayKey(selection.startsAt).slice(0, 7), undefined, { publicOnly: previewOnly })
        if (!validBookingCatalogue(calendar) || !Array.isArray(calendar.intervals) || ![calendar.serverTime, calendar.horizonEndExclusive].every(value => Number.isFinite(Date.parse(value)))) throw new Error('Não foi possível rever as opções. Tenta novamente.')
        const latest = bookableSlots(calendar, dayKey(selection.startsAt), bookingVariants(calendar.services)).find(slot => Date.parse(slot.startsAt) === Date.parse(selection.startsAt))
        if (!latest?.choices.some(choice => signature(choice) === signature(selected))) throw new Error('O horário ou as opções mudaram. Atualiza a Agenda antes de continuar. Os teus dados foram mantidos.')
      }
      setReview({ payload: { ...fields, firstName: fields.firstName.trim(), lastName: fields.lastName.trim(), locality: fields.locality.trim(), serviceId: selected.id, startsAt: selection.startsAt,
        ...(!selection.eventId ? { serviceVersion: selected.version, deliveryOptionId: selected.optionId } : {}) }, selected, endsAt })
    } catch (failure) { setError(failure.message) }
    finally { setChecking(false) }
  }
  async function send(input) {
    if (previewOnly || activeWrite.current || !input) return
    pending.current = input; activeWrite.current = true; setBusy(true); setError('')
    try {
      const result = await apiRequest(selection.eventId ? `consultations/events/${selection.eventId}/requests` : 'consultations/guests', input)
      if (typeof result.id !== 'string' || typeof result.message !== 'string') throw new Error('Não foi possível confirmar o envio. Verifica o resultado antes de continuar.')
      pending.current = null; dirty.current = false; setUncertain(false); setReceipt(result)
    } catch (failure) {
      if (failure.status && failure.status < 500) { pending.current = null; setUncertain(false); setReview(null) } else setUncertain(true)
      setError(failure.message)
    } finally { activeWrite.current = false; setBusy(false) }
  }
  return <ConsultationDialog compact label="O teu pedido" className={styles.dialog} disabled={busy || checking || uncertain} onClose={back}>
    <section data-guest-request={receipt ? undefined : 'true'} data-pending-command={busy || checking || uncertain ? 'true' : undefined}><h2 ref={reviewHeading} tabIndex="-1">{receipt ? 'Pedido recebido' : review ? 'Resumo do pedido' : 'O teu pedido'}</h2>
      {receipt ? <><p role="status">{receipt.message}</p><button type="button" onClick={onBack}>Voltar à agenda</button></> : <>
        {(error || currentSlot.error) && <p className="notice error" role="alert">{error || currentSlot.error}</p>}
        {stale && <div className="notice"><p>As opções deste horário mudaram. Os teus dados foram mantidos.</p>{choices.length > 0 && <button type="button" onClick={() => choose(choices[0])}>Rever opções atuais</button>}</div>}
        {previewOnly && <p className="notice" role="status">Pré-visualização de visitante. Os pedidos não são enviados.</p>}
        <form hidden={!!review} onChange={() => { dirty.current = true }} onSubmit={preview}>
          <fieldset className={styles.fields} disabled={busy || checking || uncertain || eventClosed || !!review}>
            {!selection.eventId && <p className={styles.date}><AppIcon name="calendar" />{bookingDate(selection.startsAt)}</p>}
            <label>Tipo de consulta<AdaptiveSelect aria-label="Tipo de consulta do pedido" value={selected.id} disabled={!!selection.eventId || new Set(choices.map(choice => choice.id)).size <= 1} onChange={e => chooseType(e.target.value)}>{!choices.some(choice => choice.id === selected.id) && <option value={selected.id}>{selected.title}</option>}{[...new Map(choices.map(service => [service.id, service])).values()].map(service => <option key={service.id} value={service.id}>{service.title}</option>)}</AdaptiveSelect></label>
            <label>Modalidade<AdaptiveSelect aria-label="Modalidade do pedido" value={selected.modality} disabled={modes.length <= 1} onChange={e => choose(choices.find(choice => choice.id === selected.id && choice.modality === e.target.value))}>{[...new Set([...modes, selected.modality])].map(mode => <option key={mode} value={mode}>{mode === 'Remote' ? 'Remota' : 'Presencial'}</option>)}</AdaptiveSelect></label>
            {selected.modality === 'InPerson' && <><label>Local<AdaptiveSelect aria-label="Local do pedido" value={variantKey(selected)} disabled={alternatives.length <= 1} onChange={e => choose(alternatives.find(choice => variantKey(choice) === e.target.value))}>{!alternatives.some(choice => variantKey(choice) === variantKey(selected)) && <option value={variantKey(selected)}>{selected.publicLocation}</option>}{alternatives.map(choice => <option key={variantKey(choice)} value={variantKey(choice)}>{choice.publicLocation}{alternatives.filter(other => other.publicLocation === choice.publicLocation).length > 1 ? ` · ${durationText(choice.durationMinutes)} · ${servicePrice(choice)}` : ''}</option>)}</AdaptiveSelect></label><p className={styles.help}>A morada completa é disponibilizada após confirmação.</p></>}
            <div className={styles.times}><AppIcon name="clock" /><div>{selection.eventId && <p>Data: <strong>{bookingDates(selection.startsAt, endsAt)}</strong></p>}<p>Início previsto: <strong>{agendaClock(selection.startsAt)}</strong></p><p>Fim previsto: <strong>{agendaClock(endsAt)}</strong></p><p>Duração prevista: <strong>{durationText(selected.durationMinutes)}</strong></p><p className={styles.price}>{servicePrice(selected)}</p></div></div>
            {event?.program && <section><h3>Programa</h3><p className={styles.eventText}>{event.program}</p></section>}
            {event?.kind === 'Retreat' && <section><h3>Pagamento</h3><p>Pagamento integral.</p></section>}
            {event?.cancellationConditions && <section><h3>Condições de cancelamento</h3><p className={styles.eventText}>{event.cancellationConditions}</p></section>}
            {onSignIn && <div className={styles.signIn}><p>Já tens conta? Inicia sessão para que o pedido fique associado à tua conta.</p><button type="button" className="secondary" onClick={onSignIn}>Iniciar sessão</button></div>}
            <fieldset className={styles.identity}><legend>A tua identificação</legend><div className={styles.names}><label>Primeiro nome<input name="firstName" required maxLength="100" autoComplete="given-name" /></label><label>Último nome<input name="lastName" required maxLength="100" autoComplete="family-name" /></label></div><label>Localidade<input name="locality" required maxLength="150" autoComplete="address-level2" /></label><div className={styles.phone}><PhoneFields required codeFirst /></div><label>Email (opcional)<input name="email" type="email" maxLength="256" autoComplete="email" /></label><p className={styles.help}>As comunicações são feitas manualmente pela terapeuta.</p></fieldset>
            <p className={styles.policy} role="note" aria-label="O que acontece a seguir">{selection.eventId ? 'Enviar o pedido não confirma a inscrição: a participação precisa de ser aprovada pela terapeuta. ' + (selected.paymentMode === 'Free' ? 'A participação nesta atividade é gratuita.' : 'Após aprovação, a terapeuta combina contigo as condições e o pagamento.') : individualRequestNotice(selected.paymentMode, { visitor: true })}</p>
            <button disabled={stale}>{checking ? 'A rever o pedido…' : 'Ver resumo do pedido'}</button>
          </fieldset>
        </form>
        {eventClosed && <p className={styles.closed}>{event.state !== 'Scheduled' ? 'Esta atividade já não permite inscrições.' : event.restricted ? 'Esta inscrição exige contacto direto com a terapeuta.' : 'As inscrições estão completas.'}</p>}
        {review && <section className={styles.review} aria-label="Resumo do pedido">
          <dl>
            <dt>Consulta ou atividade</dt><dd>{review.selected.title}</dd>
            <dt>Data</dt><dd>{bookingDates(selection.startsAt, review.endsAt)}</dd>
            <dt>Horário — Lisboa</dt><dd>{agendaClock(selection.startsAt)} — {agendaClock(review.endsAt)}</dd>
            <dt>Modalidade</dt><dd>{review.selected.modality === 'Remote' ? 'Remota' : 'Presencial'}</dd>
            {review.selected.modality === 'InPerson' && <><dt>Local</dt><dd>{review.selected.publicLocation}</dd></>}
            <dt>Valor</dt><dd>{servicePrice(review.selected)}</dd>
            <dt>Identificação</dt><dd>{review.payload.firstName} {review.payload.lastName}</dd>
            <dt>Localidade</dt><dd>{review.payload.locality}</dd>
            <dt>Telefone</dt><dd>+{review.payload.dialCode.replace(/^\+/, '')} {review.payload.phone}</dd>
            {review.payload.email && <><dt>Email</dt><dd>{review.payload.email}</dd></>}
          </dl>
          <p className={styles.warning}>isto ainda é um pedido, a ação não valida já o agendamento</p>
          <div className={styles.reviewActions}>
            <button type="button" disabled={previewOnly || busy || uncertain} onClick={() => send(pending.current || { ...review.payload, operationId: crypto.randomUUID() })}>{busy ? 'A enviar…' : 'Enviar pedido'}</button>
            <button type="button" className="secondary" disabled={busy || uncertain} onClick={() => setReview(null)}>voltar a trás</button>
          </div>
        </section>}
        {uncertain && <button type="button" disabled={busy} onClick={() => send(pending.current)}>Verificar resultado</button>}
      </>}
    </section>
  </ConsultationDialog>
}
