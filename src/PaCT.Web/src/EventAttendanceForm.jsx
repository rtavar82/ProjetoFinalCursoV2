import { useState } from 'react'
import useClosureDraft from './useClosureDraft'
import { PackChoice } from './ClosureForm'
import { instant, localDate } from './agendaTime'
import styles from './ClosureForm.module.css'

export default function EventAttendanceForm({ event, participation, disabled, send }) {
  const free = event.summary.isFree === true
  const retreat = event.summary.kind === 'Retreat'
  const draft = useClosureDraft({ ...participation, serviceTitle: event.summary.title }, {
    scope: 'event-attendance:' + participation.id, kind: 'EventAttendance', resourceId: event.summary.id,
    initialFields: { outcome: 'Performed', method: free || !participation.personId ? 'NoCharge' : 'Unpaid', amount: '', shared: '', private: '', packId: '', cashMethod: 'Cash', receivedAt: '' },
  })
  const [error, setError] = useState('')
  const fields = draft.fields
  if (!fields || !draft.available) return <p role="status">{draft.error || draft.status}</p>
  const method = retreat ? 'Unpaid' : free || fields.outcome === 'NoShow' ? 'NoCharge' : fields.method
  const input = name => ({ name, value: fields[name] || '', onChange: event => draft.change(name, event.target.value) })
  const canClose = event.summary.state === 'Performed' && participation.state === 'Confirmed' && !participation.attendance
  return <form data-protect-draft onSubmit={async event => {
    event.preventDefault(); setError('')
    try {
      await draft.flush()
      await send({ action: 'CloseParticipation', id: participation.id, version: participation.version, choice: fields.outcome, method,
        amount: retreat ? participation.agreedTotal ?? participation.finalAmount : !free && fields.amount ? Number(fields.amount) : null, sharedNote: fields.outcome === 'Performed' ? fields.shared : '', privateNote: fields.private,
        packId: method === 'Pack' ? fields.packId : undefined, method2: fields.cashMethod,
        ...(method === 'AnonymousPaid' ? { startsAt: instant(fields.receivedAt) } : {}),
      }, false, draft.clear)
    } catch (failure) { setError(failure.message) }
  }}><h3>Presença e acompanhamento</h3><p role="status">{draft.status}</p>
    {(error || draft.error) && <p className="notice error" role="alert">{error || draft.error}</p>}
    {draft.conflict && <p className="notice error">Esta inscrição mudou. O rascunho foi mantido. Volta a abrir a inscrição para rever a versão atual.</p>}
    {!canClose && <p>Esta presença já foi tratada ou ainda não pode ser fechada. O rascunho permanece disponível para consulta.</p>}
    <fieldset className={styles.fields} disabled={disabled || !canClose || draft.conflict}>
      <label>Presença<select name="outcome" value={fields.outcome} onChange={e => { draft.change('outcome', e.target.value); if (e.target.value === 'NoShow' && fields.method === 'Pack') draft.change('method', 'NoCharge') }}><option value="Performed">Esteve presente</option><option value="NoShow">Não compareceu</option></select></label>
      {retreat ? <p>O registo da presença mantém o preço e os pagamentos do retiro.</p> : free || fields.outcome === 'NoShow' ? <p>{free ? 'Participação gratuita.' : 'Falta sem dívida e sem consumo de saldo ou pack.'}</p> : <label>Tratamento financeiro<select name="method" {...input('method')}><option value="NoCharge">Sem cobrança</option>{participation.personId ? <><option value="Unpaid">Valor por pagar</option>{fields.outcome === 'Performed' && <option value="Pack">Usar uma sessão de pack</option>}</> : <option value="AnonymousPaid">Pagamento integral já recebido</option>}</select></label>}
      {!retreat && ['Unpaid', 'AnonymousPaid'].includes(method) && <label>Valor final<input name="amount" type="number" min="0.01" step="0.01" required {...input('amount')} /></label>}
      {method === 'AnonymousPaid' && <><label>Meio de recebimento<select {...input('cashMethod')}><option value="Cash">Dinheiro</option><option value="Transfer">Transferência</option><option value="MbWay">MB WAY</option><option value="Card">Cartão</option><option value="Other">Outro</option></select></label><label>Data do recebimento (Lisboa)<input type="datetime-local" required {...input('receivedAt')} /></label></>}
      {method === 'Pack' && fields.outcome === 'Performed' && <PackChoice personId={participation.personId} serviceId={event.summary.serviceId} at={localDate(new Date(event.actualStartsAt))} instant={instant} value={fields.packId || ''} onChange={e => draft.change('packId', e.target.value)} />}
      {fields.outcome === 'Performed' && <label>Nota partilhada<textarea aria-label="Nota partilhada" maxLength="8000" {...input('shared')} /></label>}
      <label>Nota privada<textarea aria-label="Nota privada" maxLength="8000" {...input('private')} /></label><button>{free ? 'Confirmar presença' : 'Confirmar presença e decisão financeira'}</button>
    </fieldset>
    {draft.conflict && canClose && <button type="button" className="secondary" disabled={disabled} onClick={draft.acceptCurrentVersion}>Revi a inscrição atual; manter este rascunho</button>}
    {!canClose && <button type="button" className="secondary" disabled={disabled} onClick={() => { if (window.confirm('Queres eliminar apenas este rascunho do aparelho?')) draft.clear().catch(failure => setError(failure.message)) }}>Eliminar rascunho do aparelho</button>}
  </form>
}
