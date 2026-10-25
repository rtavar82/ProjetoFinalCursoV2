import { useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import BookingClientSearch from './BookingClientSearch'
import ManualEventBooking from './ManualEventBooking'
import { bookingVariants } from './clientBookingOptions'
import { agendaDate, dayKey, instant, localDate, servicePrice } from './agendaTime'
import styles from './ManagerScheduling.module.css'

const conflictNames = { Consultation: 'Outra consulta ou recuperação', Guest: 'Pedido de visitante ou recuperação', Event: 'Grupo, retiro ou recuperação', Protected: 'Bloqueio protegido', Block: 'Bloqueio pessoal ou de férias' }
export default function ManualBookingForm({ setup, disabled, publish, onBack, onSaved, onWorking, onReviewStart, feedback, seed }) {
  const variants = bookingVariants(setup.services), initial = variants.find(v => v.id === seed?.serviceId && (!seed.deliveryOptionId || v.optionId === seed.deliveryOptionId)) || variants[0]
  const [person, setPerson] = useState(null), [serviceId, setServiceId] = useState(seed?.serviceId || initial?.id || ''), [mode, setMode] = useState(initial?.modality || '')
  const [place, setPlace] = useState(seed?.service?.publicLocation || ''), [optionId, setOptionId] = useState(seed?.deliveryOptionId || '')
  const [day, setDay] = useState(seed?.startsAt ? dayKey(seed.startsAt) : dayKey(new Date())), [time, setTime] = useState(seed?.startsAt ? localDate(new Date(seed.startsAt)).slice(11) : '10:00')
  const [duration, setDuration] = useState(initial?.durationMinutes || 60), [choice, setChoice] = useState(''), [review, setReview] = useState(null)
  const [error, setError] = useState(''), [reviewing, setReviewing] = useState(false), [override, setOverride] = useState(false)
  const lock = useRef(false), form = useRef(null)
  const serviceVariants = variants.filter(v => v.id === serviceId), options = serviceVariants.filter(v => v.modality === mode && (mode === 'Remote' || v.publicLocation === place))
  const variant = options.find(v => v.optionId === optionId) || (options.length === 1 ? options[0] : null)
  const stale = review && setup.revision !== review.result.revision && setup.revision !== review.setupRevision
  function selectService(id) { const first = variants.find(v => v.id === id); setServiceId(id); setMode(first?.modality || ''); setPlace(''); setOptionId(''); setDuration(first?.durationMinutes || 60); setChoice('') }
  function selectMode(value) { const first = serviceVariants.find(v => v.modality === value); setMode(value); setPlace(''); setOptionId(''); setDuration(first?.durationMinutes || duration); setChoice('') }
  function selectPlace(value) { const first = serviceVariants.find(v => v.modality === mode && v.publicLocation === value); setPlace(value); setOptionId(''); setDuration(first?.durationMinutes || duration); setChoice('') }
  async function preview(event) {
    event.preventDefault(); if (lock.current || disabled) return
    onReviewStart()
    setError('')
    try {
      if (!person) throw new Error('Pesquisa e seleciona a ficha do cliente antes de rever a marcação.')
      if (!variant) throw new Error('Escolhe a modalidade, o local e a opção da consulta.')
      if (!Number.isInteger(Number(duration)) || Number(duration) < 1 || Number(duration) > 10080) throw new Error('Indica uma duração acordada válida.')
      const input = { personId: person.id, serviceId, serviceVersion: variant.version, deliveryOptionId: variant.optionId, startsAt: instant(day + 'T' + time), durationMinutes: Number(duration), choice: choice || variant.paymentMode }
      lock.current = true; setReviewing(true); onWorking(true)
      const result = await apiRequest('consultations/manual-preview', input)
      if (!result.revision || result.serviceId !== input.serviceId || Date.parse(result.startsAt) !== Date.parse(input.startsAt)
        || result.durationMinutes !== input.durationMinutes || !Array.isArray(result.conflicts) || typeof result.canConfirm !== 'boolean') throw new Error('Não foi possível confirmar a revisão. Volta a tentar.')
      setReview({ input, result, setupRevision: setup.revision }); setOverride(false)
    } catch (failure) { setError(failure.message) }
    finally { lock.current = false; setReviewing(false); onWorking(false) }
  }
  async function confirm() {
    if (disabled || lock.current || !review || stale || !review.result.canConfirm && !(review.result.canOverrideBlock && override)) return
    lock.current = true
    const block = override ? review.result.conflicts.find(c => c.kind === 'Block') : null
    try {
      await publish({ action: 'Manual', ...review.input, manualReviewRevision: review.result.revision,
        overrideWindowId: block?.id || null, overrideWindowVersion: block?.version || null }, () => { form.current?.reset(); onSaved() }, () => setReview(null))
    } finally { lock.current = false }
  }
  const servicePicker = <label>Tipo de consulta<select aria-label="Tipo de consulta" required value={serviceId} onChange={event => selectService(event.target.value)}><option value="">Seleciona a consulta</option>{setup.services.filter(s => s.active !== false).map(service => <option key={service.id} value={service.id}>{service.title}</option>)}</select></label>
  const activity = setup.services.find(service => service.id === serviceId && service.serviceKind)
  if (activity) return <div data-card-id="manual-booking-form">{feedback}<fieldset className={styles.fields} disabled={disabled}><BookingClientSearch selected={person} onSelect={setPerson} disabled={disabled} />{servicePicker}</fieldset><ManualEventBooking key={serviceId} service={activity} person={person} seed={seed} disabled={disabled} publish={publish} onBack={onBack} onSaved={onSaved} onWorking={onWorking} onReviewStart={onReviewStart} /></div>
  return <div data-card-id="manual-booking-form"><p className={styles.intro}>Podes marcar a qualquer hora, mesmo fora dos horários publicados. Todas as horas são de Lisboa.</p>
    {feedback}{error && <p role="alert" className="notice error">{error}</p>}
    {!review ? <form ref={form} data-protect-draft onSubmit={preview}>
      <fieldset disabled={disabled || reviewing} className={styles.fields}>
        <BookingClientSearch selected={person} onSelect={setPerson} disabled={disabled || reviewing} />
        {servicePicker}
        <label>Modalidade<select aria-label="Modalidade" required value={mode} onChange={event => selectMode(event.target.value)}><option value="">Seleciona a modalidade</option>{[...new Set(serviceVariants.map(v => v.modality))].map(value => <option value={value} key={value}>{value === 'Remote' ? 'Remota' : 'Presencial'}</option>)}</select></label>
        {mode !== 'Remote' && <label>Local<select aria-label="Local" required value={place} onChange={event => selectPlace(event.target.value)}><option value="">Seleciona o local</option>{[...new Set(serviceVariants.filter(v => v.modality === mode).map(v => v.publicLocation))].map(value => <option key={value}>{value}</option>)}</select></label>}
        {options.length > 1 && <label>Opção da consulta<select aria-label="Opção da consulta" required value={optionId} onChange={event => { setOptionId(event.target.value); setDuration(options.find(v => v.optionId === event.target.value)?.durationMinutes || duration) }}><option value="">Seleciona a opção</option>{options.map(v => <option value={v.optionId} key={v.optionId}>{v.durationMinutes} min · {servicePrice(v)}</option>)}</select></label>}
        <label>Dia — Lisboa<input type="date" required min={dayKey(new Date())} value={day} onChange={event => setDay(event.target.value)} /></label>
        <label>Hora de início — Lisboa<input type="time" required step="60" value={time} onChange={event => setTime(event.target.value)} /></label>
        <label>Duração acordada (minutos)<input type="number" required min="1" max="10080" step="1" value={duration} onChange={event => setDuration(event.target.value)} /></label>
        {variant && <><p className={styles.help}>Valor: {servicePrice(variant)}. Alterar a duração acordada não altera o catálogo.</p><label>Tratamento financeiro<select value={choice} onChange={event => setChoice(event.target.value)}><option value="">Condições da consulta</option>{variant.paymentMode === 'Prepayment' && <option value="Prepayment">Pedir pagamento antecipado</option>}<option value="Postpayment">Permitir pagamento posterior</option><option value="Gift">Oferta de pagamento</option><option value="Credit">Usar crédito, sem desconto antecipado</option></select></label></>}
      </fieldset><div className={styles.actions}><button type="button" className="secondary" disabled={disabled || reviewing} onClick={onBack}>Voltar à agenda</button><button disabled={disabled || reviewing || variants.length === 0}>{reviewing ? 'A verificar horário…' : 'Rever marcação'}</button></div>
    </form> : <>
      <section className={styles.summary} aria-label="Rever marcação"><h3>Rever marcação</h3><p><strong>{[person.data.firstName, person.data.lastName].filter(Boolean).join(' ')}</strong></p><p>{review.result.title} · {review.result.modality === 'Remote' ? 'Remota' : 'Presencial'}{review.result.modality !== 'Remote' ? ' · ' + review.result.publicLocation : ''}</p><p>Início: {agendaDate(review.result.startsAt)}<br />Fim: {agendaDate(review.result.endsAt)}<br />Duração: {review.result.durationMinutes} minutos</p><p>Valor: {servicePrice({ ...review.result, paymentMode: review.input.choice === 'Gift' ? 'Free' : review.result.paymentMode })}</p></section>
      {review.result.conflicts.length > 0 ? <section className={styles.conflicts}><h3>Conflitos encontrados</h3><ul>{review.result.conflicts.map(c => <li key={c.kind + c.id}>{conflictNames[c.kind] || 'Horário indisponível'} · {agendaDate(c.startsAt)} — {agendaDate(c.endsAt)}</li>)}</ul><p>{review.result.canOverrideBlock ? 'Este bloqueio admite uma exceção expressa apenas para a marcação revista.' : 'Escolhe outro horário. O conflito impede guardar; não será criada uma marcação pendente.'}</p></section> : <p className={styles.help} role="status">Não foram encontrados conflitos. A agenda é verificada novamente ao guardar.</p>}
      {review.result.canOverrideBlock && <label className={styles.check}><input type="checkbox" checked={override} disabled={disabled} onChange={event => setOverride(event.target.checked)} /><span>Autorizo esta marcação apesar do bloqueio pessoal ou de férias revisto. O bloqueio original mantém-se.</span></label>}
      <p className={styles.help}>Guardar confirma a marcação. Esta ação não regista dinheiro recebido nem liquida a consulta.</p>
      {stale && <p role="status" className="notice">A agenda mudou depois desta revisão. Os campos foram mantidos; volta à edição e revê novamente antes de guardar.</p>}
      <div className={styles.actions}><button type="button" className="secondary" disabled={disabled} onClick={() => { setReview(null); setOverride(false) }}>Voltar à edição</button><button type="button" disabled={disabled || stale || !review.result.canConfirm && !(review.result.canOverrideBlock && override)} onClick={confirm}>Guardar marcação</button></div>
    </>}
  </div>
}
