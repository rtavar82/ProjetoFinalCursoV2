import AdaptiveSelect from './AdaptiveSelect'
import { useState } from 'react'
import useEditorState from './useEditorState'
import { PackChoice } from './ClosureForm'
import { instant, localDate, agendaMoney } from './agendaTime'
import InformationCard from './InformationCard'
import ConsultationPhotoPreview from './ConsultationPhotoPreview'
import { uploadConsultationPhoto } from './identityApi'
import styles from './ClosureForm.module.css'

export default function EventAttendanceForm({ event, participation, disabled, send }) {
  const free = event.summary.isFree === true
  const retreat = event.summary.kind === 'Retreat'
  const cancelled = event.summary.state === 'Cancelled'
  const editor = useEditorState({ outcome: 'Performed', method: free || cancelled || !participation.personId ? 'NoCharge' : event.summary.paymentMode === 'Contribution' ? 'Undefined' : 'Unpaid', amount: String(participation.finalAmount ?? participation.agreedTotal ?? participation.referencePrice ?? ''), settlementAmount: String(Math.max(0, Math.min(participation.balance || 0, participation.referencePrice || 0))), shared: '', private: '', photoIds: [], packId: '', cashMethod: 'Cash', receivedAt: localDate(new Date()) }, participation.version)
  const [error, setError] = useState(''), [review, setReview] = useState(false), [sending, setSending] = useState(false)
  const fields = editor.fields
  const method = free || cancelled || !retreat && fields.outcome === 'NoShow' ? 'NoCharge' : fields.method
  const remaining = Math.max(0, Number(fields.amount || 0) - (participation.applied || 0))
  const input = name => ({ name, value: fields[name] || '', onChange: event => editor.change(name, event.target.value) })
  const canClose = participation.canClose
  return <InformationCard as="form" cardId="participation-closure" data-protect-draft onSubmit={async event => {
    event.preventDefault(); setError('')
    if (!review) { setReview(true); return }
    if (sending) return
    setSending(true)
    try {
      const current = await editor.ready()
      if (fields.outcome !== 'Performed' && current.files.length) throw new Error('Retira as imagens antes de confirmar uma falta.')
      for (let i = 0; i < current.files.length; i++) await uploadConsultationPhoto(participation.id, fields.photoIds[i], current.files[i], participation.version)
      await send({ action: 'CloseParticipation', id: participation.id, version: participation.version, choice: fields.outcome, method,
        amount: !['NoCharge', 'Pack', 'Undefined'].includes(method) && fields.amount ? Number(fields.amount) : null, sharedNote: fields.outcome === 'Performed' ? fields.shared : '', privateNote: fields.private,
        photoIds: fields.photoIds, packId: method === 'Pack' ? fields.packId : undefined, method2: fields.cashMethod,
        ...(method === 'AnonymousPaid' ? { startsAt: instant(fields.receivedAt) } : {}),
        ...(method === 'Settle' && remaining > 0 ? { settlementAmount: Number(fields.settlementAmount) } : {}),
      }, false, editor.reset)
    } catch (failure) { setError(failure.message) } finally { setSending(false) }
  }}><h3>Presença e acompanhamento</h3>
    {error && <p className="notice error" role="alert">{error}</p>}
    {editor.conflict && <p className="notice error">Esta inscrição mudou. O preenchimento foi mantido. Revê a versão atual antes de confirmar.</p>}
    {!canClose && <p>Esta presença já foi tratada ou ainda não pode ser fechada.</p>}
    <fieldset className={styles.fields} hidden={review} disabled={disabled || sending || !canClose || editor.conflict}>
      <label>Presença<AdaptiveSelect name="outcome" value={fields.outcome} onChange={e => { editor.change('outcome', e.target.value); if (e.target.value === 'NoShow' && fields.method === 'Pack') editor.change('method', 'NoCharge') }}><option value="Performed">Esteve presente</option><option value="NoShow">Não compareceu</option>{retreat && <option value="Withdrawn">Desistiu durante o retiro</option>}</AdaptiveSelect></label>
      {cancelled || free || !retreat && fields.outcome === 'NoShow' ? <p>{free ? 'Participação gratuita.' : 'Falta sem dívida e sem consumo de saldo ou pack.'}</p> : <label>Tratamento financeiro<AdaptiveSelect name="method" {...input('method')}><option value="NoCharge">Sem cobrança</option>{participation.personId ? <><option value="Unpaid">Valor por pagar</option><option value="Settle">Liquidar com crédito, parcial ou totalmente</option>{event.summary.paymentMode === 'Contribution' && <option value="Undefined">Contribuição por definir</option>}{!retreat && fields.outcome === 'Performed' && <option value="Pack">Usar uma sessão de pack</option>}</> : <option value="AnonymousPaid">Pagamento integral já recebido</option>}</AdaptiveSelect></label>}
      {['Unpaid', 'Settle', 'AnonymousPaid'].includes(method) && <label>Valor final<input name="amount" type="number" min="0.01" step="0.01" required {...input('amount')} /></label>}
      {method === 'Settle' && <><p>Já liquidado: {agendaMoney(participation.applied || 0)} · Crédito disponível: {agendaMoney(participation.balance)}</p>{remaining > 0 ? <><label>Valor a liquidar agora<input type="number" required min="0.01" step="0.01" max={Math.min(participation.balance || 0, remaining)} {...input('settlementAmount')} /></label><p>Fica por pagar: {agendaMoney(Math.max(0, remaining - Number(fields.settlementAmount || 0)))}</p></> : <p>O valor final já está liquidado.</p>}</>}
      {method === 'AnonymousPaid' && <><label>Meio de recebimento<AdaptiveSelect {...input('cashMethod')}><option value="Cash">Dinheiro</option><option value="Transfer">Transferência</option><option value="MbWay">MB WAY</option><option value="Card">Cartão</option><option value="Other">Outro</option></AdaptiveSelect></label><label>Data do recebimento (Lisboa)<input type="datetime-local" required {...input('receivedAt')} /></label></>}
      {method === 'Pack' && fields.outcome === 'Performed' && <PackChoice personId={participation.personId} serviceId={event.summary.serviceId} at={localDate(new Date(event.actualStartsAt || event.summary.startsAt))} instant={instant} value={fields.packId || ''} onChange={e => editor.change('packId', e.target.value)} />}
      {fields.outcome === 'Performed' && <label>Nota partilhada<textarea aria-label="Nota partilhada" maxLength="8000" {...input('shared')} /></label>}
      {fields.outcome === 'Performed' && <label>Fotografias a partilhar após o fecho<input type="file" accept="image/jpeg,image/png" multiple onChange={async event => { const files = [...event.target.files]; event.target.value = ''; try { await editor.addPhotos(files); setError('') } catch (failure) { setError(failure.message) } }} /></label>}
      {editor.files.map((file, index) => <div className={styles.photo} key={fields.photoIds[index]}><p>{file.name}</p><ConsultationPhotoPreview file={file} /><button type="button" className="secondary" onClick={() => editor.removePhoto(index)}>Retirar fotografia {index + 1}</button></div>)}
      <label>Nota privada<textarea aria-label="Nota privada" maxLength="8000" {...input('private')} /></label>
    </fieldset>
    {review && <><p>{fields.outcome === 'Performed' ? 'Esteve presente' : fields.outcome === 'Withdrawn' ? 'Desistiu durante o retiro' : 'Não compareceu'}</p><p>{method === 'Undefined' ? 'Contribuição por definir' : method === 'NoCharge' ? free ? 'Gratuito' : 'Sem cobrança' : method === 'Pack' ? 'Uma sessão de pack' : `Valor final: ${agendaMoney(Number(fields.amount))}`}</p>{method === 'Settle' && <><p>Já liquidado: {agendaMoney(participation.applied || 0)} · Liquidar agora: {agendaMoney(remaining > 0 ? Number(fields.settlementAmount || 0) : 0)}</p><p>Fica por pagar: {agendaMoney(Math.max(0, remaining - (remaining > 0 ? Number(fields.settlementAmount || 0) : 0)))}</p></>}<button type="button" className="secondary" disabled={disabled || sending} onClick={() => setReview(false)}>Voltar atrás</button></>}
    <button disabled={disabled || sending || !canClose || editor.conflict}>{review ? 'Confirmar presença e decisão financeira' : 'Rever antes de confirmar'}</button>
    {editor.conflict && canClose && <button type="button" className="secondary" disabled={disabled} onClick={editor.acceptCurrentVersion}>Revi a inscrição atual; manter o preenchimento</button>}
  </InformationCard>
}
