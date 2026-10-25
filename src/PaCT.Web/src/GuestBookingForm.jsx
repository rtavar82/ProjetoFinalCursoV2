import { useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import ConsultationDialog from './ConsultationDialog'
import PhoneFields from './PhoneFields'
import AppIcon from './AppIcon'
import { agendaDate, agendaClock, agendaMoney, dayKey, servicePrice } from './agendaTime'
import { bookingVariants, bookableSlots, variantKey, validBookingCatalogue } from './clientBookingOptions'
import { durationText, readPublicEvent } from './publicAgendaData'
import styles from './VisitorAgenda.module.css'

const signature = choice => JSON.stringify([variantKey(choice), choice.version, choice.modality, choice.publicLocation, choice.durationMinutes, choice.referencePrice, choice.paymentMode])

export default function GuestBookingForm({ selection, onBack, onSignIn, onBrowseService }) {
  const choices = useMemo(() => selection.choices || [{ ...selection.service, id: selection.serviceId || selection.service.id, version: selection.serviceVersion || selection.service.version || 1, optionId: selection.deliveryOptionId || 'standard' }], [selection])
  const [selected, setSelected] = useState(choices[0]), [review, setReview] = useState(null)
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false), [error, setError] = useState(''), [receipt, setReceipt] = useState(null), [uncertain, setUncertain] = useState(false)
  const pending = useRef(null), dirty = useRef(false), activeWrite = useRef(false), reviewHeading = useRef(null)
  const event = selection.event
  const services = selection.services || choices
  function chooseType(id) {
    if (id === selected.id) return
    const available = !selection.eventId && choices.find(choice => choice.id === id)
    if (available) choose(available)
    else if (onBrowseService && (!dirty.current || window.confirm('Mudar de consulta e voltar à agenda? O preenchimento deste pedido será descartado.'))) { dirty.current = false; onBrowseService(id) }
  }
  const modes = [...new Set(choices.filter(choice => choice.title === selected?.title).map(choice => choice.modality))]
  const alternatives = choices.filter(choice => choice.title === selected?.title && choice.modality === selected?.modality)
  const endsAt = selection.endsAt || new Date(Date.parse(selection.startsAt) + selected.durationMinutes * 60000).toISOString()
  const eventClosed = !!event && (event.state !== 'Scheduled' || event.remaining <= 0 || event.restricted)
  useEffect(() => {
    function leaving(e) { if (dirty.current || pending.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', leaving)
    return () => window.removeEventListener('beforeunload', leaving)
  }, [])
  useEffect(() => { if (review) reviewHeading.current?.focus() }, [review])
  function choose(choice) { if (choice) { setSelected(choice); setReview(null); setError(''); dirty.current = true } }
  function back() { if (!busy && !checking && !uncertain && (!dirty.current || window.confirm('Queres voltar à agenda e descartar o preenchimento?'))) onBack() }
  async function preview(e) {
    e.preventDefault(); if (checking || busy || uncertain || !selected) return
    const fields = Object.fromEntries(new FormData(e.currentTarget))
    if (!fields.firstName.trim() || !fields.lastName.trim()) { setError('Preenche o primeiro e o último nome.'); return }
    setChecking(true); setError('')
    try {
      if (selection.eventId) {
        const current = await readPublicEvent(selection.eventId, selected.id)
        if (current.state !== 'Scheduled' || current.remaining <= 0 || current.restricted || Date.parse(current.startsAt) !== Date.parse(selection.startsAt) || event && current.version !== event.version)
          throw new Error('Esta atividade mudou ou já não permite pedidos. Atualiza a Agenda antes de continuar.')
      } else {
        const calendar = await apiRequest('consultations/calendar?month=' + dayKey(selection.startsAt).slice(0, 7))
        if (!validBookingCatalogue(calendar) || !Array.isArray(calendar.intervals) || ![calendar.serverTime, calendar.horizonEndExclusive].every(value => Number.isFinite(Date.parse(value)))) throw new Error('Não foi possível rever as opções. Tenta novamente.')
        const latest = bookableSlots(calendar, dayKey(selection.startsAt), bookingVariants(calendar.services)).find(slot => Date.parse(slot.startsAt) === Date.parse(selection.startsAt))
        if (!latest?.choices.some(choice => signature(choice) === signature(selected))) throw new Error('O horário ou as opções mudaram. Atualiza a Agenda antes de continuar. Os teus dados foram mantidos.')
      }
      setReview({ payload: { ...fields, firstName: fields.firstName.trim(), lastName: fields.lastName.trim(), serviceId: selected.id, startsAt: selection.startsAt,
        ...(!selection.eventId ? { serviceVersion: selected.version, deliveryOptionId: selected.optionId } : {}) }, selected, endsAt })
    } catch (failure) { setError(failure.message) }
    finally { setChecking(false) }
  }
  async function send(input) {
    if (activeWrite.current || !input) return
    if (!navigator.onLine) { setError('Sem ligação. O preenchimento foi mantido. Tenta novamente quando tiveres rede.'); return }
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
    <section data-guest-request={receipt ? undefined : 'true'} data-pending-command={busy || checking || uncertain ? 'true' : undefined}><h2>{receipt ? 'Pedido recebido' : 'O teu pedido'}</h2>
      {receipt ? <><p role="status">{receipt.message}</p><button type="button" onClick={onBack}>Voltar à agenda</button></> : <>
        {error && <p className="notice error" role="alert">{error}</p>}
        <form hidden={!!review} onChange={() => { dirty.current = true }} onSubmit={preview}>
          <fieldset className={styles.fields} disabled={busy || checking || uncertain || eventClosed}>
            <p className={styles.date}><AppIcon name="calendar" />{agendaDate(selection.startsAt)}</p>
            <label>Tipo de consulta<select aria-label="Tipo de consulta do pedido" value={selected.id} onChange={e => chooseType(e.target.value)}>{[...new Map(services.map(service => [service.id, service])).values()].map(service => <option key={service.id} value={service.id}>{service.title}</option>)}</select></label>
            <label>Modalidade<select aria-label="Modalidade do pedido" value={selected.modality} disabled={modes.length === 1} onChange={e => choose(choices.find(choice => choice.title === selected.title && choice.modality === e.target.value))}>{modes.map(mode => <option key={mode} value={mode}>{mode === 'Remote' ? 'Remota' : 'Presencial'}</option>)}</select></label>
            {selected.modality === 'InPerson' && <><label>Local<select aria-label="Local do pedido" value={variantKey(selected)} disabled={alternatives.length === 1} onChange={e => choose(alternatives.find(choice => variantKey(choice) === e.target.value))}>{alternatives.map(choice => <option key={variantKey(choice)} value={variantKey(choice)}>{choice.publicLocation}{alternatives.filter(other => other.publicLocation === choice.publicLocation).length > 1 ? ` · ${durationText(choice.durationMinutes)} · ${servicePrice(choice)}` : ''}</option>)}</select></label><p className={styles.help}>A morada completa é disponibilizada após confirmação.</p></>}
            <div className={styles.times}><AppIcon name="clock" /><div><p>Início previsto: <strong>{selection.eventId ? agendaDate(selection.startsAt) : agendaClock(selection.startsAt)}</strong></p><p>Fim previsto: <strong>{selection.eventId ? agendaDate(endsAt) : agendaClock(endsAt)}</strong></p><p>Duração prevista: <strong>{durationText(selected.durationMinutes)}</strong></p><p className={styles.price}>{servicePrice(selected)}</p></div></div>
            {event?.program && <section><h3>Programa</h3><p className={styles.eventText}>{event.program}</p></section>}
            {event?.kind === 'Retreat' && <section><h3>Pagamento</h3><p>{event.paymentPlan === 'Phased' ? 'Pagamento faseado' : 'Pagamento integral'}</p>{event.installments?.map((part, index) => <p key={index}>{index === 0 ? 'Sinal' : `Prestação ${index}`} · {agendaMoney(part.amount)} · {agendaDate(part.dueAt)}</p>)}</section>}
            {event?.cancellationConditions && <section><h3>Condições de cancelamento</h3><p className={styles.eventText}>{event.cancellationConditions}</p></section>}
            {onSignIn && <div className={styles.signIn}><p>Já tens conta? Inicia sessão para que o pedido fique associado à tua conta.</p><button type="button" className="secondary" onClick={onSignIn}>Iniciar sessão</button></div>}
            <fieldset className={styles.identity}><legend>A tua identificação</legend><div className={styles.names}><label>Primeiro nome<input name="firstName" required maxLength="100" autoComplete="given-name" /></label><label>Último nome<input name="lastName" required maxLength="100" autoComplete="family-name" /></label></div><div className={styles.phone}><PhoneFields required codeFirst /></div><label>Email (opcional)<input name="email" type="email" maxLength="256" autoComplete="email" /></label><p className={styles.help}>As comunicações são feitas manualmente pela terapeuta.</p></fieldset>
            <p className={styles.policy}>{selection.eventId ? selected.paymentMode === 'Free' ? 'A participação nesta atividade é gratuita.' : 'O pedido de inscrição aguarda aprovação. A terapeuta combina contigo as condições e o pagamento após a confirmação.' : selected.paymentMode === 'Prepayment' ? 'Esta consulta prevê pagamento antecipado. Se o horário for validado, a terapeuta combina contigo as condições e o pagamento.' : selected.paymentMode === 'Contribution' ? 'Escolhes a tua contribuição de forma livre e consciente. O pagamento é feito depois da consulta.' : selected.paymentMode === 'Free' ? 'Esta consulta é gratuita.' : 'O pagamento é feito depois da consulta.'}</p>
            <p className={styles.warning}><span aria-hidden="true">ⓘ</span><span>O pedido aguarda confirmação da terapeuta. Enviar o pedido não confirma automaticamente {selection.eventId ? 'a inscrição' : 'a marcação'}.</span></p>
            <button>{checking ? 'A rever o pedido…' : 'Ver resumo do pedido'}</button>
          </fieldset>
        </form>
        {eventClosed && <p className={styles.closed}>{event.state !== 'Scheduled' ? 'Esta atividade já não permite inscrições.' : event.restricted ? 'Esta inscrição exige contacto direto com a terapeuta.' : 'As inscrições estão completas.'}</p>}
        {review && <section className={styles.review} aria-label="Resumo do pedido">
          <h3 ref={reviewHeading} tabIndex="-1">Resumo do pedido</h3>
          <dl>
            <dt>Consulta ou atividade</dt><dd>{review.selected.title}</dd>
            <dt>Data e hora de Lisboa</dt><dd>{agendaDate(selection.startsAt)} — {agendaDate(review.endsAt)}</dd>
            <dt>Modalidade</dt><dd>{review.selected.modality === 'Remote' ? 'Remota' : 'Presencial'}</dd>
            {review.selected.modality === 'InPerson' && <><dt>Local</dt><dd>{review.selected.publicLocation}</dd></>}
            <dt>Valor</dt><dd>{servicePrice(review.selected)}</dd>
            <dt>Identificação</dt><dd>{review.payload.firstName} {review.payload.lastName}</dd>
            <dt>Telefone</dt><dd>+{review.payload.dialCode.replace(/^\+/, '')} {review.payload.phone}</dd>
            {review.payload.email && <><dt>Email</dt><dd>{review.payload.email}</dd></>}
          </dl>
          <p className={styles.warning}>isto ainda é um pedido, a ação não valida já o agendamento</p>
          <div className={styles.reviewActions}>
            <button type="button" disabled={busy || uncertain} onClick={() => send(pending.current || { ...review.payload, operationId: crypto.randomUUID() })}>{busy ? 'A enviar…' : 'Enviar pedido'}</button>
            <button type="button" className="secondary" disabled={busy || uncertain} onClick={() => setReview(null)}>volta a trás</button>
          </div>
        </section>}
        {uncertain && <button type="button" disabled={busy} onClick={() => send(pending.current)}>Verificar resultado</button>}
      </>}
    </section>
  </ConsultationDialog>
}
