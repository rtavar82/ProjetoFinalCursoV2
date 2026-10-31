import { useState } from 'react'
import { agendaMoney } from './agendaTime'
import useEditorState from './useEditorState'

export default function CreditSettlementForm({ record, manager = false, participation = false, disabled, act }) {
  const debt = record.amountDue ?? record.remaining ?? record.finalAmount ?? 0
  const maximum = Math.max(0, Math.min(record.balance || 0, debt))
  const editor = useEditorState({ amount: maximum > 0 ? String(maximum) : '' }, record.version)
  const [error, setError] = useState('')
  const proposal = record.creditProposals?.find(item => !item.decision)
  const amount = Number(editor.fields.amount || 0)
  const action = manager ? participation ? 'SettleParticipation' : 'Settle' : participation ? 'ProposeParticipationCredit' : 'ProposeCredit'
  return <section aria-label={manager ? 'Liquidar consulta com crédito' : 'Propor utilização de crédito'}>
    <h3>{manager ? 'Liquidar com crédito' : 'Propor utilização de crédito'}</h3>
    <p>Por pagar: {agendaMoney(debt)} · Crédito disponível: {agendaMoney(record.balance)}</p>
    {record.settledAmount > 0 && <p>Já liquidado: {agendaMoney(record.settledAmount)}</p>}
    {proposal && <div className="notice"><p>Proposta por verificar: {agendaMoney(proposal.amount)}</p>{manager && <button type="button" className="text-button" disabled={disabled} onClick={() => act(participation ? 'DeclineParticipationCredit' : 'DeclineCreditProposal', { relatedId: proposal.id })}>Não aplicar esta proposta</button>}</div>}
    {(manager || !proposal) && <form data-protect-draft onSubmit={async event => {
      event.preventDefault(); setError('')
      if (amount <= 0 || amount > maximum) { setError('Indica um valor até ao crédito disponível e à dívida.'); return }
      try { await act(action, { amount, ...(proposal && manager ? { relatedId: proposal.id } : {}) }) } catch (failure) { setError(failure.message) }
    }}>
      {error && <p role="alert" className="notice error">{error}</p>}
      {editor.conflict && <p className="notice">A informação mudou. O valor preenchido foi mantido.<button type="button" className="text-button" onClick={editor.acceptCurrentVersion}>Revi o saldo e a dívida</button></p>}
      <label>{manager ? 'Valor a liquidar' : 'Crédito que proponho utilizar'}<input name="creditAmount" type="number" min="0.01" max={maximum} step="0.01" required value={editor.fields.amount} onChange={event => editor.change('amount', event.target.value)} /></label>
      <p>{manager ? 'Dívida após confirmação' : 'Dívida se a gestão aceitar'}: {agendaMoney(Math.max(0, debt - Math.max(0, amount)))}</p>
      {!manager && <p>O crédito só será utilizado depois da confirmação da gestão.</p>}
      <button disabled={disabled || editor.conflict || maximum <= 0}>{manager ? 'Confirmar liquidação' : 'Enviar proposta à gestão'}</button>
    </form>}
  </section>
}
