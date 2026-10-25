import { useCallback, useState } from 'react'
import ConsultationDialog from './ConsultationDialog'
import useClosureDraft from './useClosureDraft'
import useLiveResource from './useLiveResource'
import { apiRequest } from './identityApi'
import { agendaDate, agendaClock, servicePrice } from './agendaTime'
import { bookingVariants, variantKey, validBookingCatalogue } from './clientBookingOptions'
import styles from './ClientAgenda.module.css'

export default function ClientBookingDialog({ seed, send, disabled, guard, onClose, onConfirmed, onBrowseService }) {
  const draft = useClosureDraft({ id: seed.id, version: 1, serviceTitle: 'Pedido de marcação' }, {
    scope: seed.scope, kind: 'ClientBooking', resourceId: seed.id,
    initialFields: { startsAt: seed.startsAt, selected: seed.choices?.[0] || null, review: null, pending: null },
  })
  const [error, setError] = useState(''), [checking, setChecking] = useState(false), [confirmed, setConfirmed] = useState(null)
  const read = useCallback(async signal => { const value = await apiRequest('consultations/availability', undefined, { signal }); if (!validBookingCatalogue(value)) throw new Error('Não foi possível ler as opções. Tenta novamente.'); return value }, [])
  const catalogue = useLiveResource('agenda', 'client-booking-options', read)
  const fields = draft.fields, selected = fields?.selected
  const variants = bookingVariants(catalogue.data?.services)
  const latest = variants.find(v => variantKey(v) === variantKey(selected))
  const changed = !!selected && !!catalogue.data && (!latest || latest.version !== selected.version)
  const currentModes = [...new Set(variants.filter(v => v.title === selected?.title).map(v => v.modality))]
  const alternatives = variants.filter(v => v.title === selected?.title && v.modality === selected?.modality)
  const pending = !!fields?.pending
  function choose(value) { draft.change('selected', value); draft.change('review', null); setError('') }
  async function preview(event) {
    event.preventDefault(); if (!selected || disabled || pending) return
    setChecking(true); setError('')
    try {
      await draft.flush()
      const review = await apiRequest('consultations/booking-preview', { serviceId: selected.id, serviceVersion: selected.version, deliveryOptionId: selected.optionId, startsAt: fields.startsAt })
      if (review.serviceId !== selected.id || review.serviceVersion !== selected.version || Date.parse(review.startsAt) !== Date.parse(fields.startsAt)) throw new Error('Não foi possível confirmar o resumo. Revê o pedido.')
      draft.change('review', review); await draft.flush()
    } catch (failure) { setError(failure.message); if (failure.status === 409) catalogue.refresh() }
    finally { setChecking(false) }
  }
  async function confirm(retry = false) {
    if (disabled || checking || !navigator.onLine) { if (!navigator.onLine) setError('Sem ligação. O pedido permanece guardado neste aparelho.'); return }
    if (!retry && (pending || !fields.review || changed)) return
    const command = retry ? fields.pending : { action: 'Request', operationId: crypto.randomUUID(), serviceId: selected.id, serviceVersion: selected.version, deliveryOptionId: selected.optionId, startsAt: fields.startsAt }
    if (!command) return
    setError(''); draft.change('pending', command)
    try { await draft.flush() } catch (failure) { setError(failure.message); return }
    try {
      const result = await send(command)
      setConfirmed(result)
      try { await draft.clear(); onConfirmed(result) }
      catch { setError('Pedido enviado. Não foi possível remover a cópia temporária deste aparelho.') }
    } catch (failure) {
      setError(failure.message)
      if (failure.status && failure.status < 500) { draft.change('pending', null); draft.change('review', null); await draft.flush().catch(() => {}); catalogue.refresh() }
    }
  }
  async function finishCleanup() { try { await draft.clear(); onConfirmed(confirmed) } catch (failure) { setError(failure.message) } }
  return <ConsultationDialog compact label="O teu pedido" disabled={disabled || checking || pending && !confirmed} onClose={() => guard(onClose)}>
    <section data-pending-command={disabled || pending && !confirmed ? 'true' : undefined}><h2>O teu pedido</h2>
      {(error || draft.error || catalogue.error) && <p role="alert" className="notice error">{error || draft.error || catalogue.error}</p>}
      {!fields || !draft.available ? <p role="status">{draft.error || draft.status}</p> : <>
        <p>{agendaDate(fields.startsAt)}</p><p className={styles.muted} role="status">{/^Rascunho (recuperado|guardado)/.test(draft.status) ? 'Pedido guardado neste aparelho.' : draft.status}</p>
        {changed && !pending && <div className="notice"><p>As opções desta consulta mudaram. A tua seleção foi conservada.</p>{latest && <button type="button" disabled={disabled} onClick={() => choose(latest)}>Rever opções atuais</button>}</div>}
        <form data-protect-draft onSubmit={preview}><fieldset className={styles.formFields} disabled={disabled || checking || pending || !!confirmed}>
          <label>Tipo de consulta<select aria-label="Tipo de consulta do pedido" value={selected?.title || ''} required onChange={event => { const service = catalogue.data?.services.find(s => s.title === event.target.value); if (service?.serviceKind) guard(() => onBrowseService?.(service.id)); else choose(variants.find(v => v.title === event.target.value)) }}><option value="">Escolhe a consulta</option>{[...new Set([...(catalogue.data?.services || []).map(v => v.title), selected?.title].filter(Boolean))].map(title => <option key={title}>{title}</option>)}</select></label>
          <label>Modalidade<select aria-label="Modalidade do pedido" value={selected?.modality || ''} required onChange={event => choose(variants.find(v => v.title === selected.title && v.modality === event.target.value))}><option value="">Escolhe a modalidade</option>{[...new Set([...currentModes, selected?.modality].filter(Boolean))].map(mode => <option value={mode} key={mode}>{mode === 'Remote' ? 'Remota' : 'Presencial'}</option>)}</select></label>
          {selected && (selected.modality === 'InPerson' || alternatives.length > 1) && <label>{selected.modality === 'InPerson' ? 'Local' : 'Opção'}<select aria-label={selected.modality === 'InPerson' ? 'Local do pedido' : 'Opção do pedido'} value={variantKey(selected)} required onChange={event => choose(alternatives.find(v => variantKey(v) === event.target.value))}>{!latest && <option value={variantKey(selected)}>{selected.publicLocation || 'Opção anterior'}</option>}{alternatives.map(v => <option key={variantKey(v)} value={variantKey(v)}>{v.publicLocation || 'Remota'} · {v.durationMinutes} min · {servicePrice(v)}</option>)}</select></label>}
          {selected?.modality === 'InPerson' && <p className={styles.muted}>A morada completa fica disponível após a confirmação e, quando exigido, o pagamento antecipado.</p>}
          {selected && <div className={styles.requestSummary}><p>Início previsto: <strong>{agendaClock(fields.startsAt)}</strong></p><p>Fim previsto: <strong>{agendaClock(new Date(Date.parse(fields.startsAt) + selected.durationMinutes * 60000))}</strong></p><p>Duração prevista: <strong>{selected.durationMinutes} min</strong></p><p>{servicePrice(selected)}</p></div>}
          <div className={styles.accountNote}><strong>Pedido associado à tua conta</strong><p>A tua identificação e contacto seguem junto com o pedido.</p></div>
          <p className="notice">{selected?.paymentMode === 'Prepayment' ? 'Esta consulta prevê pagamento antecipado. Se o horário for validado, recebes o pedido de pagamento e as condições para aceitar ou cancelar.' : selected?.paymentMode === 'Contribution' ? 'Escolhes a tua contribuição e pagas depois da consulta.' : selected?.paymentMode === 'Free' ? 'Esta consulta é gratuita.' : 'O pagamento é feito depois da consulta.'}</p>
          <p className="notice">O pedido aguarda confirmação da terapeuta. Enviar o pedido não confirma automaticamente a marcação.</p>
          {!fields.review && <button disabled={!selected || changed}>{checking ? 'A verificar o horário…' : 'Ver resumo do pedido'}</button>}
        </fieldset></form>
        {fields.review && !pending && !confirmed && <div className={styles.review} aria-label="Resumo do pedido"><h3>Resumo do pedido</h3><p>{fields.review.title}</p><p>{agendaDate(fields.review.startsAt)} — {agendaClock(fields.review.endsAt)}</p><p>{fields.review.modality === 'Remote' ? 'Remota' : fields.review.publicLocation}</p><p>{servicePrice(fields.review)}</p><button disabled={disabled || checking || changed} onClick={() => void confirm()}>Enviar pedido</button><button className="secondary" disabled={disabled} onClick={() => draft.change('review', null)}>Editar pedido</button></div>}
        {pending && !confirmed && <button disabled={disabled || checking} onClick={() => void confirm(true)}>Verificar envio do pedido</button>}
        {confirmed && <button disabled={disabled} onClick={() => void finishCleanup()}>Remover cópia temporária</button>}
        {draft.error && <div><button type="button" className="secondary" onClick={draft.compareSaved}>Comparar rascunho guardado</button>{draft.comparison && <><p>{draft.comparison.fields?.selected?.title || 'Pedido guardado'}</p><p>{draft.comparison.fields?.startsAt ? agendaDate(draft.comparison.fields.startsAt) : 'Sem horário guardado'}</p><p>{draft.comparison.fields?.selected?.modality === 'Remote' ? 'Remota' : draft.comparison.fields?.selected?.publicLocation}</p><button type="button" onClick={draft.replaceCompared}>Manter esta edição após comparação</button></>}</div>}
      </>}
    </section>
  </ConsultationDialog>
}
