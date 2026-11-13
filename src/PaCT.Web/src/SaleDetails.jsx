import moneyText from './moneyText'
import InformationCard from './InformationCard'
import MbWayLogo from './MbWayLogo'
import RecordTable from './RecordTable'
import { agendaDate, agendaMoney } from './agendaTime'
import { saleKinds, saleMethods } from './financialSales'

// The review and the saved record show the same lines and payment breakdown.
export default function SaleDetails({ sale, clientName }) {
  return <>
    <p>{clientName || (sale.anonymous ? 'Venda anónima' : 'Venda associada à ficha do cliente')}</p>
    <p>Recebido em {agendaDate(sale.effectiveAt)}</p>
    <p>Total: <strong>{moneyText(agendaMoney(sale.total))}</strong> · Paga</p>
    {sale.lines.map((line, index) => <InformationCard key={index} cardId={'sale-line-detail-' + index} title={line.name} headingLevel={3}>
      <p>{saleKinds[line.kind]} · {line.quantity} × {moneyText(agendaMoney(line.unitPrice))} = {moneyText(agendaMoney(line.total ?? line.quantity * line.unitPrice))}</p>
      {line.description && <p className="multiline">{line.description}</p>}
      {(line.weight || line.size) && <p>{[line.weight && 'Peso: ' + line.weight, line.size && 'Tamanho: ' + line.size].filter(Boolean).join(' · ')}</p>}
      {line.kind === 'Pack' && <><p>{line.sessions} sessões por pack · Avulso: {moneyText(agendaMoney(line.regularTotal))}</p><p>Desconto: {Number(((1 - line.unitPrice / line.regularTotal) * 100).toFixed(2))}%</p></>}
      {line.startsAt && <><p>{agendaDate(line.startsAt)} — {agendaDate(line.endsAt)}</p><p>{line.modality === 'Remote' ? 'Online' : line.location + ' · Presencial'}</p></>}
    </InformationCard>)}
    <RecordTable caption="Recebimentos da venda" columns={[{ key: 'method', label: 'Método', render: p => p.method === 'MbWay' ? <MbWayLogo compact /> : saleMethods[p.method] }, { key: 'amount', label: 'Valor recebido', render: p => agendaMoney(p.amount) }]} rows={sale.payments} rowKey={p => p.method} />
  </>
}
