import { useCallback } from 'react'
import InformationCard from './InformationCard'
import useLiveResource from './useLiveResource'
import { apiRequest } from './identityApi'
import { agendaMoney } from './agendaTime'
import styles from './FinancialCards.module.css'

export default function CreditAuthorizationCard({ personId, balance, amount, checked, onChange, disabled }) {
  const read = useCallback(signal => apiRequest(`consultations/finance?section=Balances&personId=${encodeURIComponent(personId)}&page=1`, undefined, { signal }), [personId])
  const result = useLiveResource('finance', `credit-authorization:${personId}`, read, balance == null && !!personId)
  const available = balance ?? result.data?.balance ?? 0
  const maximum = Math.max(0, Math.min(available, amount ?? available))
  return <InformationCard title="Autorização de utilização de crédito" headingLevel={3} cardId="credit-authorization" className={styles.card} loading={result.loading} error={result.error} onRetry={result.refresh}>
    <p>Crédito disponível: <strong>{agendaMoney(available)}</strong></p>
    <label className="checkbox"><input type="checkbox" name="allowClientCredit" checked={checked} onChange={onChange} disabled={disabled || result.loading || !!result.error || maximum <= 0} />Autorizar o cliente a usar este crédito.</label>
    <p className={styles.metadata}>Até {agendaMoney(maximum)}, por opção do cliente.</p>
  </InformationCard>
}
