import { useState } from 'react'
import { agendaMoney } from './agendaTime'
import useEditorState from './useEditorState'
import InformationCard from './InformationCard'
import styles from './FinancialCards.module.css'

export default function CreditSettlementForm({ record, manager = false, participation = false, disabled, act }) {
  const debt = record.amountDue ?? record.remaining ?? record.finalAmount ?? 0
  const authorized = !manager
  const maximum = Math.max(0, Math.min(record.balance || 0, debt, authorized ? (participation ? record.clientCreditAvailable : record.creditAuthorization?.available) || 0 : Infinity))
  const editor = useEditorState({ amount: maximum > 0 ? String(maximum) : '' }, record.version)
  const [error, setError] = useState(''), [review, setReview] = useState(null)
  const proposal = !participation && record.creditProposals?.find(item => !item.decision)
  const amount = Number(editor.fields.amount || 0)
  const action = manager ? participation ? 'SettleParticipation' : 'Settle' : participation ? 'UseParticipationCredit' : 'UseAuthorizedCredit'
  const content = <>
    {!review && <><p>Por pagar: {agendaMoney(debt)} · Crédito disponível: {agendaMoney(record.balance)}</p>
      {authorized && maximum !== record.balance && <p>Crédito autorizado disponível: {agendaMoney(maximum)}</p>}
      {record.settledAmount > 0 && <p>Já liquidado: {agendaMoney(record.settledAmount)}</p>}</>}
    {proposal && <div className="notice"><p>Proposta por verificar: {agendaMoney(proposal.amount)}</p>{manager && <button type="button" className="text-button" disabled={disabled} onClick={() => act('DeclineCreditProposal', { relatedId: proposal.id })}>Não aplicar esta proposta</button>}</div>}
    {(manager || authorized || !proposal) && <form data-protect-draft onSubmit={async event => {
      event.preventDefault(); setError('')
      if (amount <= 0 || amount > maximum) { setError('Indica um valor até ao crédito disponível e à dívida.'); return }
      if (!review) { setReview({ amount, debt, balance: record.balance }); return }
      try {
        const result = await act(action, { amount: review.amount, ...(proposal && manager ? { relatedId: proposal.id } : {}) })
        if (result) { setReview(null); editor.reset(result.resourceVersion, { amount: '' }) }
      } catch (failure) { setError(failure.message) }
    }}>
      {error && <p role="alert" className="notice error">{error}</p>}
      {editor.conflict && <p className="notice">O saldo ou o valor por pagar mudou. O preenchimento foi mantido.<button type="button" className="text-button" onClick={() => { editor.acceptCurrentVersion(); setReview(null) }}>Revi o saldo e o valor por pagar</button></p>}
      {!review ? <><label>{manager ? 'Valor a liquidar' : authorized ? 'Crédito que quero utilizar' : 'Crédito que proponho utilizar'}<input name="creditAmount" type="number" min="0.01" max={maximum} step="0.01" required value={editor.fields.amount} onChange={event => editor.change('amount', event.target.value)} /></label>
        <button disabled={disabled || editor.conflict || maximum <= 0}>Rever antes de confirmar</button></> : <>
        <p>Crédito a utilizar: <strong>{agendaMoney(review.amount)}</strong></p>
        <p>Saldo: {agendaMoney(review.balance)} → {agendaMoney(review.balance - review.amount)}</p>
        <p>Por pagar: {agendaMoney(review.debt)} → {agendaMoney(review.debt - review.amount)}</p>
        
        <button type="button" className="secondary" disabled={disabled} onClick={() => setReview(null)}>Voltar atrás</button>
        <button disabled={disabled || editor.conflict || maximum <= 0}>{manager ? 'Confirmar liquidação' : authorized ? 'Confirmar utilização de crédito' : 'Enviar proposta à gestão'}</button>
      </>}
    </form>}
  </>
  return <InformationCard title={manager ? 'Liquidar com crédito' : undefined} headingLevel={3} cardId="credit-settlement" className={styles.card}>
    {manager ? content : <details><summary>{authorized ? 'Usar o meu crédito' : 'Propor utilização de crédito'}</summary>{content}</details>}
  </InformationCard>
}
