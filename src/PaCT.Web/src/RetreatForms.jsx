import AdaptiveSelect from './AdaptiveSelect'
import { useState } from 'react'
import { agendaDate, agendaMoney, instant } from './agendaTime'

export function RetreatDefinition({ definition, disabled }) {
  return <fieldset disabled={disabled}><legend>Programa e condições do retiro</legend>
    <label>Programa completo<textarea name="program" required maxLength="8000" defaultValue={definition?.program || ''} /></label>
    <label>Preço único por participante<input name="totalPrice" type="number" required min="0.01" max="1000000" step="0.01" defaultValue={definition?.totalPrice ?? ''} /></label>
    <label>Condições de cancelamento<textarea name="cancellation" required maxLength="8000" defaultValue={definition?.cancellationConditions || ''} /></label>
    <p>Pagamento integral do valor indicado.</p>
  </fieldset>
}

export function RetreatPayments({ participation: p, manager, disabled, act }) {
  const [error, setError] = useState('')
  const pending = Math.max(0, (p.returnDue || 0) - (p.returned || 0))
  const submit = callback => e => { e.preventDefault(); setError(''); try { callback(new FormData(e.currentTarget)) } catch (failure) { setError(failure.message) } }
  return <section aria-label="Pagamentos do retiro"><h3>Pagamento do retiro</h3>
    {error && <p className="notice error" role="alert">{error}</p>}
    {p.agreedTotal != null && <p>Total acordado: {agendaMoney(p.agreedTotal)} · Aplicado: {agendaMoney(p.applied)} · Por liquidar: {agendaMoney(p.remaining)}</p>}
    {p.state === 'Confirmed' && <p>Pagamento integral.</p>}
    {manager && p.state === 'Confirmed' && p.remaining > 0 && <form data-protect-draft onSubmit={submit(fields => { if (window.confirm('Confirmas a liquidação deste valor com o crédito disponível?')) act('SettleParticipation', { amount: Number(fields.get('amount')) }) })}><p>Crédito disponível: {agendaMoney(p.balance)}</p><label>Valor a liquidar<input name="amount" type="number" required min="0.01" step="0.01" max={Math.min(p.balance, p.remaining)} /></label><button disabled={disabled || p.balance <= 0}>Confirmar liquidação</button></form>}
    {p.state === 'Cancelled' && <>
      {p.cancellationBy === 'Organizer' && <p>Cancelamento pela organização: restituição integral do valor aplicado.</p>}
      {manager && p.cancellationBy !== 'Organizer' && <form data-protect-draft onSubmit={submit(fields => act('DecideRetreatReturn', { amount: Number(fields.get('amount')), reason: fields.get('reason') }))}><label>Valor total a restituir<input name="amount" type="number" min={p.returned || 0} max={p.applied} step="0.01" required defaultValue={p.returnDue ?? ''} /></label><label>Motivo segundo as condições de cancelamento<textarea name="reason" required maxLength="2000" /></label><button disabled={disabled}>Registar decisão de restituição</button></form>}
      {p.returnDue != null && <p>Restituição pendente: {agendaMoney(pending)} · Restituído: {agendaMoney(p.returned)}</p>}
      {manager && pending > 0 && <form data-protect-draft onSubmit={submit(fields => act('ReturnRetreatPayment', { amount: Number(fields.get('amount')), method: fields.get('method'), startsAt: instant(fields.get('date')), conditionsAccepted: fields.has('confirmed') }))}><label>Valor a restituir<input name="amount" type="number" required min="0.01" max={pending} step="0.01" /></label><label>Destino<AdaptiveSelect name="method"><option value="Credit">Crédito na ficha, por acordo</option><option value="Transfer">Transferência</option><option value="MbWay">MB WAY</option><option value="Cash">Dinheiro</option><option value="Card">Cartão</option><option value="Other">Outro</option></AdaptiveSelect></label><label>Data efetiva (Lisboa)<input name="date" type="datetime-local" required /></label><label className="checkbox"><input name="confirmed" type="checkbox" required />Confirmo a devolução efetiva ou o acordo para manter o valor em crédito.</label><button disabled={disabled}>Registar restituição</button></form>}
    </>}
    {p.returns?.map(r => <p key={r.id}>{agendaDate(r.effectiveAt)} · {agendaMoney(r.amount)} · {r.method === 'Credit' ? 'Crédito na ficha' : r.method}</p>)}
    {manager && p.history?.filter(h => h.action === 'DecideRetreatReturn').map((h, i) => <p key={i}>{agendaDate(h.at)} · Restituição decidida: {agendaMoney(h.amount)} · {h.reason}</p>)}
  </section>
}
