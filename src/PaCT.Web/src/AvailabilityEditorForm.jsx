import AdaptiveSelect from './AdaptiveSelect'
import { useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import { addDays, agendaDate, dayKey, instant } from './agendaTime'
import { bookingVariants } from './clientBookingOptions'
import { EventEditor } from './GroupEventsPanel'
import useClientOptions from './useClientOptions'
import styles from './ManagerScheduling.module.css'

const weekday = day => new Date(day + 'T12:00:00Z').getUTCDay()
const labelDay = day => new Intl.DateTimeFormat('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'))
const weekdays = days => days.filter(day => weekday(day) !== 0 && weekday(day) !== 6)
function daysBetween(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return []
  const days = []
  for (let day = from; day <= to && days.length < 191; day = addDays(day, 1)) days.push(day)
  return days.length > 190 ? [] : days
}
export default function AvailabilityEditorForm({ setup, disabled, publish, refresh, onBack, onSaved, onWorking, onReviewStart, feedback }) {
  const today = dayKey(new Date())
  const [dates, setDates] = useState({ from: today, to: today }), [selected, setSelected] = useState([today])
  const [available, setAvailable] = useState(true), [serviceId, setServiceId] = useState(''), [wholeDays, setWholeDays] = useState(true)
  const [first, setFirst] = useState('10:00'), [last, setLast] = useState('18:00'), [audience, setAudience] = useState('All')
  const [mode, setMode] = useState(''), [place, setPlace] = useState(''), [review, setReview] = useState(null), [consent, setConsent] = useState(false)
  const [clientChoicesConfirmed, setClientChoicesConfirmed] = useState(false)
  const [error, setError] = useState(''), [reviewing, setReviewing] = useState(false), [scope, setScope] = useState('')
  const lock = useRef(false)
  const stale = review && setup.revision !== review.publication.revision
  const nothingToChange = review?.result.ranges?.length === 0
  const days = daysBetween(dates.from, dates.to)
  const service = setup.services.find(s => s.id === serviceId), event = available && !!service?.serviceKind
  const variants = bookingVariants(setup.services).filter(v => !serviceId || v.id === serviceId)
  const modes = [...new Set(variants.map(v => v.modality))]
  const places = [...new Set(variants.filter(v => v.modality === 'InPerson' && (!mode || mode === v.modality)).map(v => v.publicLocation).filter(Boolean))]
  const freeFields = available && serviceId && !event ? [!mode && 'a modalidade', mode !== 'Remote' && !place && 'o local'].filter(Boolean) : []
  const people = useClientOptions(event)
  function changeDates(next) { setDates(next); const values = daysBetween(next.from, next.to).filter(day => day >= today); setSelected(values.length === 1 ? values : weekdays(values)); setScope(''); setError('') }
  function preset(value) {
    if (!dates.from) return
    let from = dates.from < today ? today : dates.from, to = from
    if (value === 'Week') { from = addDays(from, -((weekday(from) + 6) % 7)); to = addDays(from, 6) }
    if (value === 'Month') to = addDays(from, 29)
    if (from < today) from = today
    changeDates({ from, to }); setScope(value)
  }
  function chooseService(value) { setServiceId(value); setMode(''); setPlace(''); setClientChoicesConfirmed(false) }
  function payload() {
    if (!setup.revision) throw new Error('Aguarda a leitura da agenda.')
    if (!days.length || dates.from < today || !selected.length || selected.some(day => !days.includes(day))) throw new Error('Escolhe datas válidas e assinala os dias a alterar.')
    if (freeFields.length && !clientChoicesConfirmed) throw new Error('Confirma que pretendes deixar os campos livres à escolha do cliente.')
    const windows = [...selected].sort().map(day => {
      if (!available && wholeDays) return { startsAt: instant(day + 'T00:00'), endsAt: instant(addDays(day, 1) + 'T00:00'), available: false }
      const startsAt = instant(day + 'T' + first), lastAt = instant(day + 'T' + last)
      if (lastAt < startsAt || !available && lastAt === startsAt) throw new Error('A hora final não pode ser anterior à inicial; um bloqueio deve ter duração positiva.')
      const endsAt = available ? new Date(Date.parse(lastAt) + 60000).toISOString() : lastAt
      return { startsAt, endsAt, available, ...(available ? { rules: { lastStartAt: lastAt, serviceId: serviceId || null, modality: mode || null, publicLocation: mode === 'Remote' ? null : place || null, audience, ...(freeFields.length ? { clientChoicesConfirmed } : {}) } } : {}) }
    })
    return { startsAt: instant(dates.from + 'T00:00'), endsAt: instant(addDays(dates.to, 1) + 'T00:00'), revision: setup.revision, windows, replaceWholeDays: wholeDays, confirmConflicts: false, selectedDays: [...selected].sort() }
  }
  async function preview(e) {
    e.preventDefault(); if (lock.current || disabled) return
    onReviewStart()
    setError('')
    try {
      const publication = payload(); lock.current = true; setReviewing(true); onWorking(true)
      const result = await apiRequest('consultations/availability/preview', publication)
      if (result.revision !== publication.revision || !Array.isArray(result.conflicts)) throw new Error('Não foi possível confirmar a revisão. Volta a tentar.')
      setReview({ publication, result }); setConsent(false)
    } catch (failure) { setError(failure.message); if (failure.status === 409) refresh() }
    finally { lock.current = false; setReviewing(false); onWorking(false) }
  }
  async function confirm() {
    if (lock.current || disabled || !review || stale || nothingToChange || review.result.conflicts.length > 0 && !consent) return
    lock.current = true
    try { await publish({ action: 'PublishAvailability', publication: { ...review.publication, confirmConflicts: consent } }, onSaved, () => { setReview(null); refresh() }) }
    finally { lock.current = false }
  }
  let eventSeed = null
  if (event && dates.from) {
    try { const startsAt = instant(dates.from + 'T' + first); eventSeed = { definition: { serviceId, startsAt, endsAt: service.definedPerEvent ? undefined : new Date(Date.parse(startsAt) + service.durationMinutes * 60000).toISOString(), publicLocation: service.publicLocation, capacity: 1, published: false } } } catch { /* The event editor retains its own date validation. */ }
  }
  return <div data-card-id="availability-editor-form"><p className={styles.intro}>Escolhe as datas e revê as alterações antes de publicar. As marcações existentes são mantidas.</p>
    {feedback}{error && <p role="alert" className="notice error">{error}</p>}
    {!review && <form data-protect-draft onSubmit={e => e.preventDefault()}><fieldset disabled={disabled || reviewing} className={styles.fields}>
      <div className={styles.pair}><label>Data inicial<input type="date" required min={today} value={dates.from} onChange={e => changeDates({ ...dates, from: e.target.value })} /></label><label>Data final<input type="date" required min={dates.from || today} value={dates.to} onChange={e => changeDates({ ...dates, to: e.target.value })} /></label></div>
      <nav className={styles.quick} aria-label="Seleção rápida do período">{[['Day', 'Dia'], ['Week', 'Semana'], ['Month', 'Mês']].map(([key, label]) => <button key={key} type="button" className="secondary" aria-pressed={scope === key} onClick={() => preset(key)}>{label}</button>)}</nav>
      <label>Disponibilidade<AdaptiveSelect aria-label="Disponibilidade" value={String(available)} onChange={e => setAvailable(e.target.value === 'true')}><option value="true">Aberta para agendamento</option><option value="false">Indisponível</option></AdaptiveSelect></label>
      {available && <label>Tipo de consulta / evento<AdaptiveSelect aria-label="Tipo de consulta / evento" value={serviceId} onChange={e => chooseService(e.target.value)}><option value="">Livre — consulta escolhida pelo cliente</option>{setup.services.filter(s => s.active !== false).map(s => <option value={s.id} key={s.id}>{s.title}</option>)}</AdaptiveSelect></label>}
    </fieldset></form>}
    {event ? <EventEditor fixedService key={serviceId} event={eventSeed || { definition: { serviceId } }} setup={{ data: setup }} people={people} disabled={disabled || reviewing} send={input => publish(input, onSaved)} onBack={onBack} /> : <form data-protect-draft onSubmit={preview}>
      {!review ? <fieldset className={styles.fields} disabled={disabled || reviewing}>
        <fieldset className={styles.days}><legend>Dias a alterar</legend><div className={styles.dayChoices}>{days.map(day => <label key={day}><input type="checkbox" checked={selected.includes(day)} disabled={day < today} onChange={e => setSelected(e.target.checked ? [...selected, day] : selected.filter(value => value !== day))} />{labelDay(day)}</label>)}</div>
          {days.length > 1 && <div className={styles.dayTools}><button type="button" className="text-button" onClick={() => setSelected(weekdays(days.filter(day => day >= today)))}>Segunda a sexta</button><button type="button" className="text-button" onClick={() => setSelected(days.filter(day => day >= today))}>Todos os dias</button><button type="button" className="text-button" onClick={() => setSelected([])}>Limpar seleção</button></div>}
        </fieldset>
        <section className={styles.changeCard} aria-label="O que alterar">
          <label>O que alterar<AdaptiveSelect aria-label="O que alterar" value={String(wholeDays)} onChange={e => setWholeDays(e.target.value === 'true')}><option value="true">{available ? 'Substituir o horário dos dias escolhidos' : 'Fechar os dias completos'}</option><option value="false">{available ? 'Alterar apenas estas horas' : 'Fechar apenas estas horas'}</option></AdaptiveSelect></label>
          <p className={styles.help}>{wholeDays ? available ? 'Nos dias escolhidos, fica só o horário indicado abaixo. As outras horas deixam de aceitar pedidos.' : 'Fecha os dias escolhidos para novos pedidos.' : available ? 'Altera apenas as horas indicadas abaixo. As outras horas mantêm-se.' : 'Fecha apenas as horas indicadas abaixo. As outras horas mantêm-se.'}</p>
          <p className={styles.help}>Os horários com marcações mantêm-se.</p>
        </section>
        {(available || !wholeDays) && <div className={styles.pair}><label>{available ? 'Primeiro início' : 'Bloquear das'}<input type="time" step="60" required value={first} onChange={e => setFirst(e.target.value)} /></label><label>{available ? 'Último início permitido' : 'Bloquear até'}<input type="time" step="60" required value={last} onChange={e => setLast(e.target.value)} /></label></div>}
        {available && <><div className={styles.pair}><label>Visibilidade<AdaptiveSelect aria-label="Visibilidade" value={audience} onChange={e => setAudience(e.target.value)}><option value="All">Visitantes e registados</option><option value="Registered">Só registados</option></AdaptiveSelect></label><label>Modalidade<AdaptiveSelect aria-label="Modalidade" value={mode} onChange={e => { setMode(e.target.value); setPlace(''); setClientChoicesConfirmed(false) }}><option value="">Livre — escolhida pelo cliente</option>{modes.map(value => <option value={value} key={value}>{value === 'Remote' ? 'Remota' : 'Presencial'}</option>)}</AdaptiveSelect></label></div>
          {mode !== 'Remote' && <div className={styles.pair}><label>Local<AdaptiveSelect aria-label="Local" value={place} onChange={e => { setPlace(e.target.value); setClientChoicesConfirmed(false) }}><option value="">Livre — escolhido pelo cliente</option>{places.map(value => <option key={value}>{value}</option>)}</AdaptiveSelect></label></div>}
          {freeFields.length > 0 && <section className="notice" aria-label="Campos à escolha do cliente"><p>Falta definir {freeFields.join(' e ')}. Podes deixar esses campos à escolha do cliente.</p><label className="checkbox"><input type="checkbox" checked={clientChoicesConfirmed} onChange={e => setClientChoicesConfirmed(e.target.checked)} />Confirmo que os campos livres ficam à escolha do cliente.</label></section>}
        </>}
        <p className={styles.help}>{available ? '10h–18h é apenas a predefinição. ' : ''}Só os dias assinalados são alterados.</p>
      </fieldset> : <>
        <section className={styles.summary} aria-label="Rever alterações"><h3>Rever alterações</h3><p>{review.publication.selectedDays.length} {review.publication.selectedDays.length === 1 ? 'dia' : 'dias'} · {available ? `Aberta · inícios ${first}–${last}` : 'Indisponível'} · {wholeDays ? 'substitui o horário dos dias selecionados' : 'altera apenas as horas escolhidas'}</p><p>{review.publication.selectedDays.map(labelDay).join(' · ')}</p>{available && <p>{service?.title || 'Consulta livre'} · {audience === 'All' ? 'Visitantes e registados' : 'Só registados'} · {mode === 'Remote' ? 'Remota' : mode === 'InPerson' ? 'Presencial' : 'Modalidade livre'}{mode !== 'Remote' ? ' · ' + (place || 'Local livre') : ''}</p>}<p>As marcações existentes são mantidas.</p></section>
        {review.result.conflicts.length > 0 ? <><section className={styles.conflicts} role="alert" aria-label="Horários com marcações"><h3>Há horários com marcações</h3><ul>{review.result.conflicts.map(c => <li key={c.id}><strong>{c.process.processLabel}</strong><br />{agendaDate(c.startsAt)} — {agendaDate(c.endsAt)}</li>)}</ul><p>Estes horários e os 30 minutos de pausa ficam como estão.</p></section>{!nothingToChange && <label className={styles.check}><input type="checkbox" checked={consent} disabled={disabled} onChange={e => setConsent(e.target.checked)} /><span>Quero alterar os restantes horários e manter estes blocos.</span></label>}</> : <p className={styles.help} role="status">Sem sobreposições. A agenda volta a ser verificada ao publicar.</p>}
        {nothingToChange && <p className="notice" role="status">Não há horários sem marcações para alterar. Escolhe outras datas ou horas.</p>}
        {stale && <p className="notice" role="status">A agenda mudou. Volta à edição e revê as alterações.</p>}
      </>}
      <div className={styles.actions}>{review ? <><button type="button" className="secondary" disabled={disabled} onClick={() => setReview(null)}>Voltar à edição</button><button type="button" disabled={disabled || stale || nothingToChange || review.result.conflicts.length > 0 && !consent} onClick={confirm}>Validar e publicar</button></> : <><button type="button" className="secondary" disabled={disabled || reviewing} onClick={onBack}>Voltar à agenda</button><button disabled={disabled || reviewing || !selected.length}>{reviewing ? 'A rever…' : 'Rever antes de validar'}</button></>}</div>
    </form>}
  </div>
}
