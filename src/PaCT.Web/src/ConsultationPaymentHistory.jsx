import InformationCard from './InformationCard'
import { agendaDate, agendaMoney } from './agendaTime'
import styles from './FinancialCards.module.css'

const labels = { Receipt: 'Recebido em crédito', Settlement: 'Pago com crédito', SettlementReturn: 'Crédito reposto', Reversal: 'Recebimento anulado' }
export default function ConsultationPaymentHistory({ entries = [] }) {
  if (!entries.length) return null
  return <InformationCard cardId="consultation-payment-history" className={styles.card}>
    <details><summary>Histórico de pagamentos ({entries.length})</summary><ol className={styles.history}>
      {entries.map(entry => <li key={entry.id}><p><strong>{labels[entry.kind] || entry.kind}: {agendaMoney(entry.amount)}</strong></p><p className={styles.metadata}>{agendaDate(entry.at)} · {entry.author}</p></li>)}
    </ol></details>
  </InformationCard>
}
