import { useCallback, useState } from 'react'
import { apiRequest } from './identityApi'
import PushConsent from './PushConsent'
import InformationCard from './InformationCard'
import useLiveResource from './useLiveResource'

const money = value => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value ?? 0)
const kinds = { Receipt: 'Recebimento', Refund: 'Devolução', Settlement: 'Pagamento com crédito', Restitution: 'Reposição de valor do retiro', Reversal: 'Movimento compensatório', Adjustment: 'Correção financeira', AdjustmentReversal: 'Anulação de correção' }
export default function ClientFinance({ onOpenDomain }) {
  const [page, setPage] = useState(1)
  const read = useCallback(signal => apiRequest(`consultations/finance?section=Balances&page=${page}`, undefined, { signal }), [page])
  const resource = useLiveResource('finance', 'client:' + page, read)
  const data = resource.data
  return <InformationCard title="Saldo e movimentos" cardId="client-finance" loading={resource.loading} refreshing={resource.refreshing} error={resource.error} onRetry={resource.refresh}>{data && <>
    <p>Saldo: {money(data.balance)}</p>
    {data.additionalObligations?.map(item => <p key={item.id}><button className="text-button" onClick={() => onOpenDomain?.(item.kind, item.resourceId)}>{item.title} · {money(item.amount)} por pagar</button></p>)}
    {data.balance < 0 && <div className="notice error" role="status"><h3>Saldo negativo por correção</h3><p>Valor por regularizar: {money(-data.balance)}. Este valor é separado dos pagamentos das consultas.</p><p>O próximo recebimento confirmado começa por regularizar este saldo.</p></div>}
    <details><summary>Consultar movimentos</summary>{(data.entries || []).map(e => <article key={e.id}><p>{kinds[e.kind] || 'Movimento financeiro'} · {money(e.amount)}</p><p>{new Date(e.createdAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })} · Saldo após movimento: {money(e.resultingBalance)}</p></article>)}<div className="consultation-tabs"><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Movimentos anteriores</button><span>Página {page}</span><button disabled={page * 8 >= data.total} onClick={() => setPage(p => p + 1)}>Mais movimentos</button></div></details>
  </>}<PushConsent /></InformationCard>
}
