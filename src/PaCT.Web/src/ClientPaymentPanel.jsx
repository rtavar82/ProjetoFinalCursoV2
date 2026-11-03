import InformationCard from './InformationCard'
import CreditSettlementForm from './CreditSettlementForm'
import ConsultationConditionsForm from './ConsultationConditionsForm'
import ConsultationPaymentHistory from './ConsultationPaymentHistory'
import PublicPaymentMethods from './PublicPaymentMethods'
import { agendaMoney } from './agendaTime'
import styles from './FinancialCards.module.css'

export default function ClientPaymentPanel({ consultation: c, disabled, act, participation = false }) {
  const accepting = c.actions?.includes('Accept')
  const awaitingReceipt = c.process?.processLabel.includes('Aguarda confirmação de recebimento')
  const information = c.paymentInformation || c.paymentConditions?.paymentInformation
  const receiptConfirmed = c.financialChoice === 'Prepayment' && c.state !== 'Performed' && !c.expectationOpen && !!c.advanceSatisfiedAt
  return <div className={styles.cards}>
    <InformationCard title={participation ? 'Pagamento da participação' : 'Pagamento da consulta'} headingLevel={3} cardId="client-payment-summary" className={styles.card}>
      {awaitingReceipt ? <p>Aguarda confirmação de recebimento pela terapeuta.</p> : <p className={styles.amount}>Por pagar: <strong>{c.finalAmount == null && c.state === 'Performed' ? 'Valor por definir' : agendaMoney(c.amountDue ?? c.finalAmount ?? c.referencePrice)}</strong></p>}
      {receiptConfirmed && <p>Recebimento confirmado. Falta liquidar a marcação.</p>}
      {accepting ? <ConsultationConditionsForm key={`${c.id}:${c.version}:${c.termsVersion}`} consultation={c} disabled={disabled} onAccept={values => act('Accept', values)} />
        : information && !receiptConfirmed && <details><summary>Consultar formas de pagamento</summary><PublicPaymentMethods information={information} heading={false} advance={c.state !== 'Performed' && c.financialChoice === 'Prepayment'} /></details>}
      {!accepting && c.actions?.includes('DeclarePayment') && <button type="button" className="secondary" disabled={disabled} onClick={() => void act('DeclarePayment')}>Comunicar pagamento à terapeuta</button>}
    </InformationCard>
    {c.actions?.includes('UseAuthorizedCredit') && <CreditSettlementForm key={c.id} record={c} participation={participation} disabled={disabled} act={act} />}
    <ConsultationPaymentHistory entries={c.paymentHistory} />
  </div>
}
