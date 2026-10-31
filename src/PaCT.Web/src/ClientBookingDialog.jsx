import AdaptiveSelect from './AdaptiveSelect'
import { useEffect, useRef, useState } from 'react'
import ConsultationDialog from './ConsultationDialog'
import useEditorState from './useEditorState'
import useBookingSlot from './useBookingSlot'
import { apiRequest } from './identityApi'
import { agendaClock, servicePrice } from './agendaTime'
import { variantKey } from './clientBookingOptions'
import { individualRequestNotice } from './bookingRequestNotice'
import styles from './ClientAgenda.module.css'

const bookingDate = value => new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', dateStyle: 'long' }).format(new Date(value))

function RequestDetails({ value, startsAt }) {
  const end = value.endsAt || new Date(Date.parse(startsAt) + value.durationMinutes * 60000).toISOString()
  return <dl className={styles.bookingDetails}>
    <div><dt>Consulta</dt><dd>{value.title}</dd></div>
    <div><dt>Data</dt><dd>{bookingDate(startsAt)}</dd></div>
    <div><dt>Horário — Lisboa</dt><dd>{agendaClock(startsAt)} — {agendaClock(end)}</dd></div>
    <div><dt>Modalidade</dt><dd>{value.modality === 'Remote' ? 'Remota' : 'Presencial'}</dd></div>
    {value.modality === 'InPerson' && <div><dt>Local</dt><dd>{value.publicLocation}</dd></div>}
    <div><dt>Valor</dt><dd>{servicePrice(value)}</dd></div>
  </dl>
}

export default function ClientBookingDialog({ seed, send, disabled, guard, onClose, onConfirmed }) {
  const editor = useEditorState({ startsAt: seed.startsAt, selected: seed.choices?.[0] || null, review: null, pending: null }, 1)
  const [error, setError] = useState(''), [checking, setChecking] = useState(false)
  const catalogue = useBookingSlot(seed.startsAt)
  const fields = editor.fields, selected = fields?.selected
  const variants = catalogue.slot?.choices || seed.choices || []
  const latest = variants.find(v => variantKey(v) === variantKey(selected))
  const changed = !!selected && !!catalogue.data && (!latest || latest.version !== selected.version)
  const currentModes = [...new Set(variants.filter(v => v.id === selected?.id).map(v => v.modality))]
  const alternatives = variants.filter(v => v.id === selected?.id && v.modality === selected?.modality)
  const pending = !!fields?.pending
  const reviewing = !!fields?.review || pending
  const heading = useRef(null)
  useEffect(() => {
    heading.current?.focus()
    heading.current?.closest('dialog')?.scrollTo({ top: 0 })
  }, [reviewing])
  function choose(value) { editor.change('selected', value); editor.change('review', null); setError('') }
  async function preview(event) {
    event.preventDefault(); if (!selected || disabled || pending) return
    setChecking(true); setError('')
    try {
      const review = await apiRequest('consultations/booking-preview', { serviceId: selected.id, serviceVersion: selected.version, deliveryOptionId: selected.optionId, startsAt: fields.startsAt })
      if (review.serviceId !== selected.id || review.serviceVersion !== selected.version || Date.parse(review.startsAt) !== Date.parse(fields.startsAt)) throw new Error('Não foi possível confirmar o resumo. Revê o pedido.')
      editor.change('review', review)
    } catch (failure) { setError(failure.message); if (failure.status === 409) catalogue.refresh() }
    finally { setChecking(false) }
  }
  async function confirm(retry = false) {
    if (disabled || checking || !navigator.onLine) { if (!navigator.onLine) setError('Sem ligação. O preenchimento permanece apenas neste formulário aberto.'); return }
    if (!retry && (pending || !fields.review || changed)) return
    const command = retry ? fields.pending : { action: 'Request', operationId: crypto.randomUUID(), serviceId: selected.id, serviceVersion: selected.version, deliveryOptionId: selected.optionId, startsAt: fields.startsAt }
    if (!command) return
    setError(''); editor.change('pending', command)
    try {
      const result = await send(command)
      onConfirmed(result)
    } catch (failure) {
      setError(failure.message)
      if (failure.status && failure.status < 500) { editor.change('pending', null); editor.change('review', null); catalogue.refresh() }
    }
  }
  return <ConsultationDialog compact label="O teu pedido" disabled={disabled || checking || pending} onClose={() => guard(onClose)}>
    <section data-pending-command={disabled || pending ? 'true' : undefined}><h2 ref={heading} tabIndex="-1">{reviewing ? 'Resumo do pedido' : 'O teu pedido'}</h2>
      {(error || catalogue.error) && <p role="alert" className="notice error">{error || catalogue.error}</p>}
      <>
        {!reviewing && <p>{bookingDate(fields.startsAt)}</p>}
        {changed && !pending && <div className="notice"><p>As opções desta consulta mudaram. A tua seleção foi conservada.</p>{variants.length > 0 && !reviewing && <button type="button" disabled={disabled} onClick={() => choose(latest || variants[0])}>Rever opções atuais</button>}</div>}
        {!reviewing && <form data-protect-draft onSubmit={preview}><fieldset className={styles.formFields} disabled={disabled || checking}>
          <label>Tipo de consulta<AdaptiveSelect aria-label="Tipo de consulta do pedido" value={selected?.title || ''} required disabled={new Set(variants.map(v => v.id)).size <= 1} onChange={event => choose(variants.find(v => v.title === event.target.value))}>{[...new Set([...variants.map(v => v.title), !selected?.serviceKind && selected?.title].filter(Boolean))].map(title => <option key={title}>{title}</option>)}</AdaptiveSelect></label>
          <label>Modalidade<AdaptiveSelect aria-label="Modalidade do pedido" value={selected?.modality || ''} required disabled={currentModes.length <= 1} onChange={event => choose(variants.find(v => v.id === selected.id && v.modality === event.target.value))}>{[...new Set([...currentModes, selected?.modality].filter(Boolean))].map(mode => <option value={mode} key={mode}>{mode === 'Remote' ? 'Remota' : 'Presencial'}</option>)}</AdaptiveSelect></label>
          {selected && (selected.modality === 'InPerson' || alternatives.length > 1) && <label>{selected.modality === 'InPerson' ? 'Local' : 'Opção'}<AdaptiveSelect aria-label={selected.modality === 'InPerson' ? 'Local do pedido' : 'Opção do pedido'} value={variantKey(selected)} required disabled={alternatives.length <= 1} onChange={event => choose(alternatives.find(v => variantKey(v) === event.target.value))}>{!latest && <option value={variantKey(selected)}>{selected.publicLocation || 'Opção anterior'}</option>}{alternatives.map(v => <option key={variantKey(v)} value={variantKey(v)}>{v.publicLocation || 'Remota'} · {v.durationMinutes} min · {servicePrice(v)}</option>)}</AdaptiveSelect></label>}
          {selected?.modality === 'InPerson' && <p className={styles.muted}>{selected.paymentMode === 'Prepayment' ? 'A morada completa fica disponível após a confirmação do pagamento antecipado pago.' : 'A morada completa fica disponível após a confirmação.'}</p>}
          {selected && <div className={styles.requestSummary}><p>Início previsto: <strong>{agendaClock(fields.startsAt)}</strong></p><p>Fim previsto: <strong>{agendaClock(new Date(Date.parse(fields.startsAt) + selected.durationMinutes * 60000))}</strong></p><p>Duração prevista: <strong>{selected.durationMinutes} min</strong></p><p>{servicePrice(selected)}</p></div>}
          <div className={styles.accountNote}><strong>Pedido associado à tua conta</strong><p>A tua identificação e contacto seguem junto com o pedido.</p></div>
          <p className="notice" role="note" aria-label="O que acontece a seguir">{individualRequestNotice(selected?.paymentMode)}</p>
          <button disabled={!selected || changed}>{checking ? 'A verificar o horário…' : 'Ver resumo do pedido'}</button>
        </fieldset></form>}
        {reviewing && <section aria-label="Resumo do pedido">
          <RequestDetails value={fields.review || selected} startsAt={fields.review?.startsAt || fields.startsAt} />
          <p className="notice" role="note" aria-label="O que acontece a seguir">{individualRequestNotice((fields.review || selected)?.paymentMode)}</p>
          {!pending && <div className={styles.bookingActions}><button disabled={disabled || checking || changed} onClick={() => void confirm()}>Enviar pedido</button><button className="secondary" disabled={disabled || checking} onClick={() => editor.change('review', null)}>voltar a trás</button></div>}
        </section>}
        {pending && <button disabled={disabled || checking} onClick={() => void confirm(true)}>Verificar envio do pedido</button>}
      </>
    </section>
  </ConsultationDialog>
}
