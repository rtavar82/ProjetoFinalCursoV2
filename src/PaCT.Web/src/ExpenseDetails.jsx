import moneyText from './moneyText'
import DisclosureSummary from './DisclosureSummary'
import Heading from './Heading'
import InformationCard from './InformationCard'
import MbWayLogo from './MbWayLogo'
import RecordTable from './RecordTable'
import { agendaDate, agendaMoney } from './agendaTime'
import { cents, saleMethods } from './financialSales'

const date = value => value ? new Date(value + 'T12:00:00').toLocaleDateString('pt-PT') : ''
export default function ExpenseDetails({ expense, authors = {}, review = false }) {
  return <>
    <InformationCard cardId="expense-values" title={expense.description} headingLevel={3}>
      <p>Data da despesa: {date(expense.date)}</p>
      <p>Fornecedor: {expense.supplierName || 'Sem fornecedor'}</p>
      {expense.invoiceNumber && <p>Fatura {expense.invoiceNumber} · {date(expense.invoiceDate)}</p>}
      <p>Total: <strong>{moneyText(agendaMoney(expense.total))}</strong> · Investimentos: {moneyText(agendaMoney(expense.investments))}</p>
      <p>Pago: <strong>{moneyText(agendaMoney(expense.paid))}</strong> · Por pagar: <strong>{moneyText(agendaMoney(expense.remaining))}</strong></p>
    </InformationCard>
    <RecordTable caption="Linhas da despesa" columns={[
      { key: 'description', label: 'Descrição', render: row => row.description }, { key: 'categoryName', label: 'Categoria', render: row => row.categoryName },
      { key: 'kind', label: 'Tipo', render: row => row.kind === 'Investment' ? 'Investimento' : 'Despesa' },
      { key: 'quantity', label: 'Quantidade', render: row => row.quantity }, { key: 'unitPrice', label: 'Preço unitário', render: row => agendaMoney(row.unitPrice) },
      { key: 'vat', label: 'IVA', render: row => row.vat == null ? '—' : row.vat === 'Included' ? 'Incluído' : row.vat + ' %' },
      { key: 'total', label: 'Total', render: row => agendaMoney(row.total) },
    ]} rows={expense.lines.map((line, i) => ({ ...line, id: i }))} rowKey={row => row.id} />
    {expense.lines.some(line => line.allocations?.length) && <InformationCard title="Repartição por atividade e local" cardId="expense-allocations" headingLevel={3}>
      {expense.lines.map((line, index) => line.allocations?.length > 0 && <div key={index}>
        <p><strong>{line.description}</strong></p>
        <ul>{line.allocations.map((allocation, item) => <li key={item}>
          {allocation.activity ? allocation.activity.title + ' · ' + agendaDate(allocation.activity.startsAt) : 'Sem atividade específica'}
          {allocation.location && ' · ' + allocation.location} · <strong>{moneyText(agendaMoney(allocation.amount))}</strong>
        </li>)}</ul>
        <p>Despesa geral: {moneyText(agendaMoney((cents(line.total) - line.allocations.reduce((sum, allocation) => sum + cents(allocation.amount), 0)) / 100))}</p>
      </div>)}
    </InformationCard>}
    {expense.document && <p>{review ? 'Documento: ' + expense.document.name : <a href={'/api/finance/expenses/' + expense.id + '/document?version=' + expense.version} download={expense.document.name}>Descarregar {expense.document.name}</a>}</p>}
    {!!expense.payments.length && <details open={review}><DisclosureSummary>Pagamentos efetuados ({expense.payments.length})</DisclosureSummary>{expense.payments.map((p, index) => <InformationCard key={p.id || index} cardId={'expense-payment-' + index}>
      <p><strong>{moneyText(agendaMoney(p.amount))}</strong> · {p.method === 'MbWay' ? <MbWayLogo compact /> : saleMethods[p.method]} · {agendaDate(p.effectiveAt)}</p>
      {p.recordedAt && <small>{authors[p.authorId] || 'Gestão'} · Registado em {agendaDate(p.recordedAt)}</small>}
    </InformationCard>)}</details>}
    {!review && <Heading level={3}>{expense.remaining === 0 ? 'Paga' : expense.paid > 0 ? 'Parcialmente paga' : 'Por pagar'}</Heading>}
  </>
}
