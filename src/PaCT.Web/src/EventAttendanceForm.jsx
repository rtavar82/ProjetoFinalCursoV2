import AdaptiveSelect from './AdaptiveSelect'
import { useState } from 'react'
import useEditorState from './useEditorState'
import { PackChoice } from './ClosureForm'
import { instant, localDate, agendaMoney } from './agendaTime'
import styles from './ClosureForm.module.css'

export default function EventAttendanceForm({ event, participation, disabled, send }) {
  const free = event.summary.isFree === true
  const retreat = event.summary.kind === 'Retreat'
  const editor = useEditorState({ outcome: 'Performed', method: free || !participation.personId ? 'NoCharge' : 'Unpaid', amount: String(participation.referencePrice ?? ''), settlementAmount: String(Math.max(0, Math.min(participation.balance || 0, participation.referencePrice || 0))), shared: '', private: '', packId: '', cashMethod: 'Cash', receivedAt: '' }, participation.version)
  const [error, setError] = useState('')
  const fields = editor.fields
  const method = retreat ? 'Unpaid' : free || fields.outcome === 'NoShow' ? 'NoCharge' : fields.method
  const input = name => ({ name, value: fields[name] || '', onChange: event => editor.change(name, event.target.value) })
  const canClose = event.summary.state === 'Performed' && participation.state === 'Confirmed' && !participation.attendance
  return <form data-protect-draft onSubmit={async event => {
    event.preventDefault(); setError('')
    try {
      await send({ action: 'CloseParticipation', id: participation.id, version: participation.version, choice: fields.outcome, method,
        amount: retreat ? participation.agreedTotal ?? participation.finalAmount : !free && method !== 'Undefined' && fields.amount ? Number(fields.amount) : null, sharedNote: fields.outcome === 'Performed' ? fields.shared : '', privateNote: fields.private,
        packId: method === 'Pack' ? fields.packId : undefined, method2: fields.cashMethod,
        ...(method === 'AnonymousPaid' ? { startsAt: instant(fields.receivedAt) } : {}),
        ...(method === 'Settle' ? { settlementAmount: Number(fields.settlementAmount) } : {}),
      }, false, editor.reset)
    } catch (failure) { setError(failure.message) }
  }}><h3>Presença e acompanhamento</h3>
    {error && <p className="notice error" role="alert">{error}</p>}
    {editor.conflict && <p className="notice error">Esta inscrição mudou. O preenchimento foi mantido. Revê a versão atual antes de confirmar.</p>}
    {!canClose && <p>Esta presença já foi tratada ou ainda não pode ser fechada.</p>}
    <fieldset className={styles.fields} disabled={disabled || !canClose || editor.conflict}>
      <label>Presença<AdaptiveSelect name="outcome" value={fields.outcome} onChange={e => { editor.change('outcome', e.target.value); if (e.target.value === 'NoShow' && fields.method === 'Pack') editor.change('method', 'NoCharge') }}><option value="Performed">Esteve presente</option><option value="NoShow">Não compareceu</option></AdaptiveSelect></label>
      {retreat ? <p>O registo da presença mantém o preço e os pagamentos do retiro.</p> : free || fields.outcome === 'NoShow' ? <p>{free ? 'Participação gratuita.' : 'Falta sem dívida e sem consumo de saldo ou pack.'}</p> : <label>Tratamento financeiro<AdaptiveSelect name="method" {...input('method')}><option value="NoCharge">Sem cobrança</option>{participation.personId ? <><option value="Unpaid">Valor por pagar</option><option value="Settle">Liquidar com crédito, parcial ou totalmente</option>{event.summary.paymentMode === 'Contribution' && <option value="Undefined">Contribuição por definir</option>}{fields.outcome === 'Performed' && <option value="Pack">Usar uma sessão de pack</option>}</> : <option value="AnonymousPaid">Pagamento integral já recebido</option>}</AdaptiveSelect></label>}
      {!retreat && ['Unpaid', 'Settle', 'AnonymousPaid'].includes(method) && <label>Valor final<input name="amount" type="number" min="0.01" step="0.01" required {...input('amount')} /></label>}
      {method === 'Settle' && <><p>Crédito disponível: {agendaMoney(participation.balance)}</p><label>Valor a liquidar agora<input type="number" required min="0.01" step="0.01" max={Math.max(0, Math.min(participation.balance || 0, Number(fields.amount) || 0))} {...input('settlementAmount')} /></label><p>Fica por pagar: {agendaMoney(Math.max(0, Number(fields.amount || 0) - Number(fields.settlementAmount || 0)))}</p></>}
      {method === 'AnonymousPaid' && <><label>Meio de recebimento<AdaptiveSelect {...input('cashMethod')}><option value="Cash">Dinheiro</option><option value="Transfer">Transferência</option><option value="MbWay">MB WAY</option><option value="Card">Cartão</option><option value="Other">Outro</option></AdaptiveSelect></label><label>Data do recebimento (Lisboa)<input type="datetime-local" required {...input('receivedAt')} /></label></>}
      {method === 'Pack' && fields.outcome === 'Performed' && <PackChoice personId={participation.personId} serviceId={event.summary.serviceId} at={localDate(new Date(event.actualStartsAt))} instant={instant} value={fields.packId || ''} onChange={e => editor.change('packId', e.target.value)} />}
      {fields.outcome === 'Performed' && <label>Nota partilhada<textarea aria-label="Nota partilhada" maxLength="8000" {...input('shared')} /></label>}
      <label>Nota privada<textarea aria-label="Nota privada" maxLength="8000" {...input('private')} /></label><button>{free ? 'Confirmar presença' : 'Confirmar presença e decisão financeira'}</button>
    </fieldset>
    {editor.conflict && canClose && <button type="button" className="secondary" disabled={disabled} onClick={editor.acceptCurrentVersion}>Revi a inscrição atual; manter o preenchimento</button>}
  </form>
}
