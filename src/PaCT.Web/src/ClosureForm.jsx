import DateRangeFields from './DateRangeFields'
import AdaptiveSelect from './AdaptiveSelect'
import { useCallback, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import useEditorState from './useEditorState'
import { uploadConsultationPhoto } from './identityApi'
import styles from './ClosureForm.module.css'
import { localDate } from './agendaTime'
import ConsultationPhotoPreview from './ConsultationPhotoPreview'
import CreditAuthorizationCard from './CreditAuthorizationCard'
import Pagination from './Pagination'


export default function ClosureForm({ detail, disabled, onClose, instant, canClose = true, fixedOutcome = null }) {
  const editor = useEditorState({ outcome: fixedOutcome || 'Performed', method: detail.paymentMode === 'Free' ? 'Free' : detail.financialChoice === 'Gift' ? 'Gift' : 'Unpaid', start: localDate(new Date(detail.startsAt)), end: localDate(new Date(detail.endsAt)), amount: String(detail.referencePrice ?? ''), settlementAmount: String(Math.max(0, Math.min(detail.balance || 0, (detail.referencePrice || 0) - (detail.settledAmount || 0)))), shared: '', private: '', availability: '', photoIds: [], packId: '', allowClientCredit: false }, detail.version)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const fields = editor.fields
  const remaining = Math.max(0, Number(fields.amount || 0) - (detail.settledAmount || 0))
  async function confirm(event) {
    event.preventDefault()
    if (sending) return
    setSending(true); setError('')
    try {
      const current = await editor.ready(), values = current.fields
      if (values.outcome !== 'Performed' && current.files.length) throw new Error('As fotografias só podem ser partilhadas numa consulta realizada. Conserva ou remove as imagens antes de alterar o resultado.')
      const startsAt = values.outcome === 'Performed' ? instant(values.start) : undefined
      const endsAt = values.outcome === 'Performed' ? instant(values.end) : undefined
      if (values.outcome === 'Performed' && Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('O fim efetivo tem de ser posterior ao início efetivo. Corrige os horários antes de confirmar.')
      for (let i = 0; i < current.files.length; i++) await uploadConsultationPhoto(detail.id, values.photoIds[i], current.files[i], detail.version)
      await onClose({ action: 'Close', id: detail.id, version: detail.version, choice: values.outcome,
        method: values.method, availabilityChoice: values.availability, amount: values.amount ? Number(values.amount) : null,
        ...(values.method === 'Settle' && values.outcome === 'Performed' ? { settlementAmount: Number(values.settlementAmount) } : {}),
        ...(values.method === 'Pack' && values.outcome === 'Performed' ? { packId: values.packId } : {}),
        allowClientCredit: values.outcome === 'Performed' && ['Unpaid', 'Settle', 'Undefined'].includes(values.method) && !!values.allowClientCredit,
        startsAt, endsAt, sharedNote: values.shared, privateNote: values.private, photoIds: values.photoIds || [] }, editor.reset)
    } catch (failure) { setError(failure.message) } finally { setSending(false) }
  }
  const input = name => ({ value: fields[name], onChange: event => editor.change(name, event.target.value) })
  const outcomeLabels = { Performed: 'Consulta realizada', NoShow: 'Não compareceu', CancelledManager: 'Cancelada pela gestora' }
  const confirmLabels = { Performed: 'Confirmar consulta realizada', NoShow: 'Confirmar falta', CancelledManager: 'Confirmar cancelamento pela gestora' }
  return <form data-protect-draft onSubmit={confirm}><h3>{fixedOutcome ? outcomeLabels[fixedOutcome] : 'Fechar consulta'}</h3>
    {!canClose && <p className="notice">A consulta já foi tratada e este formulário não pode ser enviado.</p>}
    {editor.conflict && <div className="notice error" role="alert">A consulta mudou. O preenchimento não foi substituído.<button type="button" className="secondary" onClick={editor.acceptCurrentVersion}>Revi a consulta atual; manter estes campos para continuar</button></div>}
    {error && <div className="notice error" role="alert">{error}</div>}
    <fieldset disabled={disabled || sending || !canClose || editor.conflict} className={styles.fields}>
      {!fixedOutcome && <label>Resultado<AdaptiveSelect name="outcome" {...input('outcome')}><option value="Performed">Realizada</option><option value="NoShow">Não compareceu</option><option value="CancelledManager">Cancelada pela terapeuta</option></AdaptiveSelect></label>}
      {fields.outcome === 'Performed' ? <><DateRangeFields startLabel="Início efetivo" endLabel="Fim efetivo" required exclusive value={{ start: fields.start, end: fields.end }} onChange={next => { editor.change('start', next.start); editor.change('end', next.end) }} />
        <label>Tratamento financeiro<AdaptiveSelect name="method" {...input('method')}><option value="Unpaid">Por pagar</option><option value="Settle">Liquidar com crédito, parcial ou totalmente</option><option value="Pack">Usar uma sessão de pack</option><option value="Gift">Oferta</option>{detail.paymentMode === 'Free' && <option value="Free">Gratuita</option>}{detail.paymentMode === 'Contribution' && <option value="Undefined">Contribuição por definir</option>}</AdaptiveSelect></label>
        {fields.method === 'Pack' && <PackChoice personId={detail.personId} serviceId={detail.serviceId} at={fields.start} instant={instant} value={fields.packId || ''} onChange={event => editor.change('packId', event.target.value)} />}
        {['Unpaid', 'Settle'].includes(fields.method) && <label>Valor final<input type="number" name="amount" min="0.01" step="0.01" required {...input('amount')} /></label>}
        {detail.settledAmount > 0 && <p>Já pago com crédito: {new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(detail.settledAmount)}. O valor já liquidado é considerado neste fecho.</p>}
        {fields.method === 'Settle' && <><p>Crédito disponível: {new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(detail.balance || 0)}</p><label>Valor a liquidar agora<input type="number" name="settlementAmount" min="0.01" step="0.01" max={Math.max(0, Math.min(detail.balance || 0, remaining))} required {...input('settlementAmount')} /></label><p>Fica por pagar: {new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(Math.max(0, remaining - Number(fields.settlementAmount || 0)))}</p></>}
        {['Unpaid', 'Settle', 'Undefined'].includes(fields.method) && <CreditAuthorizationCard balance={Math.max(0, (detail.balance || 0) - (fields.method === 'Settle' ? Number(fields.settlementAmount || 0) : 0))} amount={fields.method === 'Undefined' ? undefined : Math.max(0, Number(fields.amount || 0) - (detail.settledAmount || 0) - (fields.method === 'Settle' ? Number(fields.settlementAmount || 0) : 0))} checked={!!fields.allowClientCredit} onChange={event => editor.change('allowClientCredit', event.target.checked)} disabled={disabled || sending} />}
        <label>Nota partilhada (opcional)<textarea name="shared" maxLength="8000" {...input('shared')} /></label></> : <p>Sem dívida. O crédito já utilizado será reposto no saldo.</p>}
      {fields.outcome === 'CancelledManager' && <label>Disponibilidade após cancelar<AdaptiveSelect name="availability" required {...input('availability')}><option value="">Escolhe o destino do horário</option><option value="Release">Libertar o horário</option><option value="Keep">Manter bloqueado</option></AdaptiveSelect></label>}
      <label>Nota privada (opcional)<textarea name="private" maxLength="8000" {...input('private')} /></label>
      {fields.outcome === 'Performed' && <label>Fotografias a partilhar após o fecho<input type="file" accept="image/jpeg,image/png" multiple onChange={async event => { const files = [...event.target.files]; event.target.value = ''; try { await editor.addPhotos(files); setError('') } catch (failure) { setError(failure.message) } }} /></label>}
      {editor.files.map((file, index) => <div className={styles.photo} key={fields.photoIds[index]}><p>{file.name}</p><ConsultationPhotoPreview file={file} /><button type="button" className="secondary" onClick={() => editor.removePhoto(index)}>Retirar fotografia {index + 1} </button></div>)}
      <p>O resultado e o valor definido não podem ser alterados depois de confirmar.</p>{canClose && <button>{fixedOutcome ? confirmLabels[fixedOutcome] : 'Confirmar fecho definitivo'}</button>}
    </fieldset>
  </form>
}

export function PackChoice({ personId, serviceId, at, instant, value, onChange }) {
  const [page, setPage] = useState(1)
  let reference = ''
  try { reference = at ? instant(at) : '' } catch { /* Keep the editor unchanged until the date is valid. */ }
  const query = new URLSearchParams({ personId, serviceId: serviceId || '', at: reference, scope: 'Compatible', page })
  const key = query.toString()
  const read = useCallback(signal => apiRequest('consultations/packs?' + key, undefined, { signal }), [key])
  const result = useLiveResource('packs', key, read, !!reference && !!serviceId)
  return <div>{!reference && <p>Preenche o início efetivo para escolheres o pack.</p>}{result.error && <p role="alert">{result.error}</p>}
    <label>Pack compatível<AdaptiveSelect name="packId" value={value} onChange={onChange} required><option value="">Seleciona o pack</option>{result.data?.items.map(pack => <option key={pack.id} value={pack.id}>{pack.title} · {pack.remaining} sessões</option>)}</AdaptiveSelect></label>
    <Pagination total={result.data?.total} page={page} onChange={setPage} />
  </div>
}
