import moneyText from './moneyText'
import useRecoveryEditor from './useRecoveryEditor'
import useRecoveryState from './useRecoveryState'
import DisclosureSummary from './DisclosureSummary'
import AppArrow from './AppArrow'
import { useCallback, useRef, useState } from 'react'
import ActionButton from './ActionButton'
import CardGrid from './CardGrid'
import CancelledExpenseReview from './CancelledExpenseReview'
import ConsultationDialog from './ConsultationDialog'
import ExpenseDetails from './ExpenseDetails'
import ExpenseEditor from './ExpenseEditor'
import InformationCard from './InformationCard'
import Pagination from './Pagination'
import SearchInput from './SearchInput'
import SummaryCard from './SummaryCard'
import SectionTabs from './SectionTabs'
import layout from './FinancialLayout.module.css'
import useLiveResource from './useLiveResource'
import { apiRequest } from './identityApi'
import { showSuccess } from './actionNotices'
import { agendaDate, agendaMoney } from './agendaTime'

const sections = { Unpaid: 'Por pagar', Paid: 'Pagas', All: 'Todas', CancelledEvents: 'Eventos cancelados' }
const actions = { Created: 'Registo inicial', Updated: 'Alteração', Paid: 'Pagamento registado', Reviewed: 'Repartição revista' }
export default function ExpensesPanel({ guard, disabled, presentation = 'default' }) {
  const workspace = presentation === 'workspace'
  const [section, setSection] = useRecoveryState('view:' + 'expenses' + ':section', 'Unpaid'), [term, setTerm] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1)
  const [detailId, setDetailId] = useState(null), [detailVisit, setDetailVisit] = useState(0), [historyPage, setHistoryPage] = useState(1), [editor, setEditor] = useRecoveryEditor('expenses', 'finance/expenses/', 'expenses', 'expense', ['paymentOnly'])
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), pending = useRef(false)
  const query = new URLSearchParams({ section, term: search, page }).toString()
  const read = useCallback(signal => apiRequest('finance/expenses?' + query, undefined, { signal }), [query])
  const list = useLiveResource('expenses', query, read)
  const readDetail = useCallback(signal => apiRequest(`finance/expenses/${detailId}?historyPage=${historyPage}`, undefined, { signal }), [detailId, historyPage])
  const detail = useLiveResource('expenses', detailId + ':' + historyPage + ':' + detailVisit, readDetail, !!detailId)
  const locked = disabled || busy
  async function write(id, input) {
    if (pending.current) throw new Error('Aguarda a confirmação do envio em curso.')
    pending.current = true; setBusy(true); setError('')
    try {
      const result = await apiRequest('finance/expenses' + (id ? '/' + id : ''), input)
      if (!result.confirmed || !result.expense?.id || id && result.expense.id !== id || result.expense.version !== input.version + 1) throw new Error('Não foi possível confirmar o registo devolvido pelo servidor. O preenchimento foi mantido.')
      showSuccess(result.message, `expense:${result.expense.id}:${result.expense.version}`)
      return result
    } catch (failure) { setError(failure.message); throw failure }
    finally { pending.current = false; setBusy(false) }
  }
  function closeDetail() { if (!locked) { setDetailId(null); setError('') } }
  return <section className={workspace ? layout.page : undefined} aria-label="Despesas e investimentos" data-pending-command={busy || undefined}>
    <InformationCard variant={workspace ? 'plain' : 'default'} cardId="expenses-header" title="Despesas e investimentos" actions={<ActionButton variant={workspace ? 'tinted' : 'primary'} disabled={locked || !list.data || !!list.error} onClick={() => guard(() => { setError(''); setEditor({ expense: null }) })}>Nova despesa ou investimento</ActionButton>} />
    {workspace ? <SectionTabs label="Estado das despesas" compactMobile value={section} disabled={locked} items={Object.entries(sections).map(([id, label]) => ({ id, label }))} onChange={id => { setSection(id); setPage(1) }} /> : (<nav className="consultation-tabs" aria-label="Estado das despesas">{Object.entries(sections).map(([id, label]) => <ActionButton key={id} variant={section === id ? 'primary' : 'secondary'} aria-pressed={section === id} disabled={locked} onClick={() => { setSection(id); setPage(1) }}>{label}</ActionButton>)}</nav>)}
    <InformationCard variant={workspace ? 'plain' : 'default'} cardId="expense-search"><details className={workspace ? layout.filter : undefined}><DisclosureSummary>Pesquisar despesas</DisclosureSummary><form onSubmit={e => { e.preventDefault(); setSearch(term.trim()); setPage(1); if (term.trim() === search) list.refresh() }}>
      <label>Descrição, fornecedor, fatura, categoria, atividade ou local<SearchInput disabled={locked} maxLength="200" value={term} showClear={!!(term || search)} onChange={e => setTerm(e.target.value)} onClear={() => { setTerm(''); setSearch(''); setPage(1) }} /></label><ActionButton type="submit" disabled={locked}>Pesquisar</ActionButton>
    </form></details></InformationCard>
    {(list.loading || list.error) && <InformationCard cardId="expense-list-status" loading={list.loading} error={list.error} onRetry={list.refresh} />}
    {list.data && <><SummaryCard variant={workspace ? 'compact' : 'default'} cardId="expense-count" label={sections[section]} value={list.data.total} unit="registos" icon="wallet" />
      <CardGrid layout={workspace ? 'appointments' : undefined}>{list.data.items.map(expense => {
        const action = <ActionButton variant={workspace ? 'tinted' : 'text'} disabled={locked} onClick={() => { setHistoryPage(1); setDetailVisit(v => v + 1); setError(''); setDetailId(expense.id) }}>Ver despesa</ActionButton>
        return <InformationCard as="article" cardId={'expense-' + expense.id} key={expense.id} title={expense.description} headingLevel={3} footer={workspace ? action : undefined}>
          <p className={workspace ? layout.status : undefined} data-typography={workspace ? 'process-status' : undefined}>{expense.remaining === 0 ? 'Paga' : expense.paid > 0 ? 'Parcialmente paga' : 'Por pagar'}</p>
          {expense.supplierName && <p>{expense.supplierName}</p>}<p>Total: <strong>{moneyText(agendaMoney(expense.total))}</strong> · Por pagar: <strong>{moneyText(agendaMoney(expense.remaining))}</strong></p>
          {!workspace && action}
        </InformationCard>
      })}</CardGrid>
      {!list.data.total && <InformationCard cardId="expense-empty"><p>{section === 'CancelledEvents' ? 'Não há gastos de eventos cancelados por rever nesta lista.' : 'Não existem despesas nesta lista.'}</p></InformationCard>}
      <Pagination total={list.data.total} page={page} pageSize={list.data.pageSize} correctPage={!list.error} onChange={setPage} disabled={locked} label="Páginas das despesas" />
    </>}
    {detailId && <ConsultationDialog title="Detalhe da despesa" label="Detalhe da despesa" disabled={locked} onClose={() => guard(closeDetail)}>
      <InformationCard cardId="expense-detail-status" variant="plain" loading={detail.loading} error={detail.error} onRetry={detail.refresh}>
        {detail.data && <><ExpenseDetails expense={detail.data.expense} authors={detail.data.authors} />
          {error && <p className="notice error" role="alert">{error}</p>}
          {detail.data.pendingReviews?.map(item => <CancelledExpenseReview key={JSON.stringify(item)} item={item}
            line={detail.data.expense.lines[item.lineIndex]} version={detail.data.expense.version} disabled={locked || detail.refreshing || !!detail.error}
            onConfirm={input => write(detailId, input)} />)}
          <div className="button-row"><ActionButton variant="secondary" disabled={locked || detail.loading || !!detail.error} onClick={() => guard(() => { setEditor({ expense: detail.data.expense }); closeDetail() })}>Editar despesa</ActionButton>
            {detail.data.expense.remaining > 0 && <ActionButton disabled={locked || detail.loading || !!detail.error} onClick={() => guard(() => { setEditor({ expense: detail.data.expense, paymentOnly: true }); closeDetail() })}>Registar pagamento efetuado</ActionButton>}</div>
          <details><DisclosureSummary>Histórico de alterações</DisclosureSummary>{detail.data.history.map(item => <details key={item.expense.version}><DisclosureSummary>{actions[item.action]} · {agendaDate(item.expense.updatedAt)} · Versão {item.expense.version}</DisclosureSummary>
            <small>{detail.data.authors?.[item.expense.authorId] || 'Gestão'}</small>{item.reason && <p>Motivo: {item.reason}</p>}
            {item.review && <p>{moneyText(agendaMoney(item.review.original.amount))} · {item.review.original.activity.title} <AppArrow direction="right" /> {item.review.decision === 'Keep' ? 'Mantido no evento cancelado' : item.review.destination?.title || 'Despesa geral'}</p>}
            <ExpenseDetails expense={item.expense} authors={detail.data.authors} />
          </details>)}<Pagination total={detail.data.historyTotal} page={historyPage} onChange={setHistoryPage} disabled={locked} label="Páginas do histórico da despesa" /></details>
        </>}
      </InformationCard>
    </ConsultationDialog>}
    {editor && <ExpenseEditor {...editor} disabled={locked} error={error} clearError={() => setError('')} guard={guard} write={write} onClose={() => { setEditor(null); setError('') }} />}
  </section>
}
