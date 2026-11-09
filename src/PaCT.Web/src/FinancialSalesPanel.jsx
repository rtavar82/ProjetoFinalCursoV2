import { useCallback, useState } from 'react'
import ActionButton from './ActionButton'
import AdaptiveSelect from './AdaptiveSelect'
import CardGrid from './CardGrid'
import ClientSearch from './ClientSearch'
import ConsultationDialog from './ConsultationDialog'
import DateRangeFields from './DateRangeFields'
import InformationCard from './InformationCard'
import Pagination from './Pagination'
import SaleDetails from './SaleDetails'
import SaleEditor from './SaleEditor'
import SummaryCard from './SummaryCard'
import useLiveResource from './useLiveResource'
import useConsultationNames from './useConsultationNames'
import { apiRequest } from './identityApi'
import { agendaDate, agendaMoney, setDateRangeParams } from './agendaTime'
import { saleKinds } from './financialSales'

export default function FinancialSalesPanel({ personId = null, own = false, send, disabled, guard = action => action(), feedback, perform, notify }) {
  const [creating, setCreating] = useState(false), [detailId, setDetailId] = useState(null)
  const [page, setPage] = useState(1), [client, setClient] = useState(null), [filters, setFilters] = useState('')
  const [filterError, setFilterError] = useState('')
  const person = personId || client?.id || ''
  const query = `page=${page}${person ? '&personId=' + person : ''}${filters}`
  const read = useCallback(signal => apiRequest('finance/sales?' + query, undefined, { signal }), [query])
  const list = useLiveResource('sales', query, read)
  const readDetail = useCallback(signal => apiRequest('finance/sales/' + detailId, undefined, { signal }), [detailId])
  const detail = useLiveResource('sales', 'sale:' + detailId, readDetail, !!detailId)
  const names = useConsultationNames(list.data?.items || [], detail.data, !own)
  return <section aria-label={own ? 'As minhas compras' : personId ? 'Vendas do cliente' : 'Vendas'}>
    <InformationCard title={own ? 'As minhas compras' : 'Vendas'} cardId="sales-header" actions={!personId && !own && <ActionButton disabled={disabled || !!list.error || !list.data} onClick={() => guard(() => setCreating(true))}>Registar venda</ActionButton>}>
      {!personId && !own && <p>Regista artigos, packs e serviços já pagos. Podes juntar várias linhas e métodos de recebimento.</p>}
      <details><summary>{own ? 'Pesquisar compras' : 'Pesquisar vendas'}</summary><form onSubmit={event => {
        event.preventDefault(); const values = new FormData(event.currentTarget); const query = new URLSearchParams()
        try {
          if (values.get('kind')) query.set('kind', values.get('kind'))
          setDateRangeParams(query, values.get('from'), values.get('to'))
          setFilters('&' + query); setPage(1)
          setFilterError('')
        } catch (failure) { setFilterError(failure.message) }
      }}><div className="fields-grid"><label>Tipo de venda<AdaptiveSelect name="kind"><option value="">Todos os tipos</option>{Object.entries(saleKinds).map(([key, text]) => <option value={key} key={key}>{text}</option>)}</AdaptiveSelect></label>
        <DateRangeFields type="date" startName="from" endName="to" startLabel="Desde" endLabel="Até" />
        {!personId && !own && <div className="full-width"><ClientSearch purpose="filter" selected={client} disabled={disabled} onSelect={value => { setClient(value); setPage(1) }} /></div>}
        </div><ActionButton type="submit" disabled={disabled}>Pesquisar</ActionButton>
      </form></details>
      {filterError && <p className="notice error" role="alert">{filterError}</p>}
    </InformationCard>
    {(list.loading || list.error || names.error) && <InformationCard cardId="sales-status" loading={list.loading} error={list.error || names.error} onRetry={list.error ? list.refresh : names.refresh} />}
    {list.data && <><SummaryCard cardId="sales-count" label={own ? 'Compras registadas' : 'Vendas registadas'} value={list.data.total} unit="registos" icon="wallet" />
      <CardGrid>{list.data.items.map(sale => <InformationCard key={sale.id} as="article" cardId={'sale-' + sale.id} title={sale.lines.map(line => line.name).join(' · ')}>
        {!own && <p>{sale.anonymous ? 'Venda anónima' : names.data?.[sale.personId] || 'Ficha de cliente'}</p>}<p>{agendaDate(sale.effectiveAt)} · {agendaMoney(sale.total)} · Paga</p>
        <ActionButton variant="text" disabled={disabled} onClick={() => setDetailId(sale.id)}>{own ? 'Ver compra e recebimentos' : 'Ver venda e recebimentos'}</ActionButton>
      </InformationCard>)}</CardGrid>
      {list.data.total === 0 && <InformationCard cardId="sales-empty"><p>{own ? 'Não existem compras nesta pesquisa.' : 'Não existem vendas nesta pesquisa.'}</p></InformationCard>}
      <Pagination total={list.data.total} page={page} pageSize={list.data.pageSize} correctPage={!list.error} label="Páginas das vendas" disabled={disabled} onChange={setPage} />
    </>}
    {creating && <SaleEditor send={send} disabled={disabled} guard={guard} feedback={feedback} perform={perform} notify={notify} onClose={() => { setCreating(false); setPage(1) }} />}
    {detailId && <ConsultationDialog title={own ? 'Compra e recebimentos' : 'Venda e recebimentos'} label={own ? 'Detalhe da compra' : 'Detalhe da venda'} onClose={() => setDetailId(null)}><InformationCard variant="plain" cardId="sale-detail" loading={detail.loading} error={detail.error} onRetry={detail.refresh}>
      {detail.data && <SaleDetails sale={detail.data} clientName={own ? 'A tua compra' : names.data?.[detail.data.personId]} />}
    </InformationCard></ConsultationDialog>}
  </section>
}
