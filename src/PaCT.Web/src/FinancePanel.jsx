import moneyText from './moneyText'
import RecoveryForm from './RecoveryForm'
import DisclosureSummary from './DisclosureSummary'
import AppArrow from './AppArrow'
import CalendarInput from './CalendarInput'
import DateRangeFields from './DateRangeFields'
import FinancialSalesPanel from './FinancialSalesPanel'
import ExpensesPanel from './ExpensesPanel'
import FinancialReportsPanel from './FinancialReportsPanel'
import ConsultationPriceCorrectionDialog from './ConsultationPriceCorrectionDialog'
import AdaptiveSelect from './AdaptiveSelect'
import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import ClientSearch from './ClientSearch'
import useRecoveryState from './useRecoveryState'
import InformationCard from './InformationCard'
import Pagination from './Pagination'
import CardGrid from './CardGrid'
import SummaryCard from './SummaryCard'
import ActionButton from './ActionButton'
import SectionTabs from './SectionTabs'
import Heading from './Heading'
import AppIcon from './AppIcon'
import useConsultationNames from './useConsultationNames'
import layout from './FinancialLayout.module.css'
import styles from './FinancePanel.module.css'
import { localDate, setDateRangeParams } from './agendaTime'

const currency = value => value == null ? 'Por definir' : new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value)
const names = { Receipt: 'Recebimento', Refund: 'Devolução', Settlement: 'Liquidação', SettlementReturn: 'Crédito reposto', Restitution: 'Reposição de valor do retiro', Reversal: 'Anulação / movimento compensatório', Adjustment: 'Correção financeira', AdjustmentReversal: 'Anulação de correção' }
const origins = { GeneralCredit: 'Crédito geral', Consultation: 'Consulta/pedido', Sale: 'Venda', EventService: 'Evento/serviço', Pack: 'Compra de pack' }

export function FinancialEntryForm({ people = [], selectedClient = null, consultation = null, participation = null, refund = false, disabled, submit, instant, reviewBeforeSubmit = false }) {
  const [review, setReview] = useState(null)
  const [openedAt] = useState(() => localDate(new Date()))
  const fixedPersonId = consultation?.personId || participation?.personId
  const [chosenClient, setClient] = useRecoveryState(`finance:${refund ? 'refund' : 'receipt'}:${consultation?.id || participation?.id || selectedClient?.id || 'general'}:client`, selectedClient)
  const client = fixedPersonId ? people.find(p => p.id === fixedPersonId) || { id: fixedPersonId, data: { firstName: 'Ficha de cliente' } } : chosenClient
  const person = client?.id || ''
  const origin = consultation ? 'Consultation' : participation ? 'EventService' : undefined
  const canSubmit = !!person && (refund || !!origin)
  const settlesContribution = !refund && (consultation?.state === 'Performed' && consultation.paymentMode === 'Contribution' && consultation.finalAmount == null || participation?.attendance === 'Performed' && participation.paymentMode === 'Contribution' && participation.finalAmount == null)
  return <RecoveryForm as={InformationCard} elementProps={{ as: 'form' }} recoveryKey={'financial-entry:' + (consultation?.id || participation?.id || selectedClient?.id || 'general') + ':' + refund} recoveryVersion={consultation?.version ?? participation?.version ?? null} recoveryScopes={['finance:' + (refund ? 'refund' : 'receipt') + ':' + (consultation?.id || participation?.id || selectedClient?.id || 'general') + ':']} cardId="financial-entry" data-protect-draft onSubmit={async e => {
    e.preventDefault()
    if (reviewBeforeSubmit && !review) { setReview(new FormData(e.currentTarget)); return }
    const result = await submit(e, supplied => {
    const f = review || supplied
    if (!person) throw new Error('Pesquisa e seleciona a ficha do cliente.')
    if (!refund && !origin) throw new Error('Abre a consulta ou a inscrição para registar o recebimento.')
    const effective = instant(f.get('effective'))
    if (Date.parse(effective) > Date.now()) throw new Error(`A data ${refund ? 'da devolução' : 'do recebimento'} não pode ser futura. Confirma a data e a hora indicadas.`)
    return { action: refund ? 'Refund' : 'Receipt', personId: person, id: refund ? undefined : consultation?.id,
      version: consultation?.version ?? participation?.version, origin: refund ? undefined : origin, originReference: participation?.id,
      amount: Number(f.get('amount')), startsAt: effective, method: f.get('method'), reason: f.get('reason') }
    })
    if (result) setReview(null)
  }}>
    <h3>{refund ? 'Registar devolução efetuada' : 'Registar recebimento confirmado'}</h3>
    <fieldset disabled={disabled} hidden={!!review}>
    {!consultation && <ClientSearch purpose="finance" selected={client} readOnly={!!fixedPersonId} disabled={disabled} onSelect={setClient} />}
    {!refund && participation && <label>Origem<AdaptiveSelect value="EventService" disabled>
      <option value="EventService">{origins.EventService}</option>
    </AdaptiveSelect></label>}
    {settlesContribution && <p>O valor recebido define a contribuição e paga esta {participation ? 'participação' : 'consulta'} na mesma confirmação.</p>}
    <label>Valor efetivo<input name="amount" type="number" required min="0.01" step="0.01" defaultValue={consultation?.amountDue > 0 ? consultation.amountDue : participation?.remaining > 0 ? participation.remaining : consultation?.finalAmount ?? consultation?.referencePrice ?? participation?.finalAmount ?? participation?.agreedTotal ?? participation?.referencePrice ?? ''} /></label>
    <label>Data e hora efetivas<CalendarInput name="effective" type="datetime-local" defaultValue={openedAt} required /></label>
    <label>Método<AdaptiveSelect name="method"><option value="Transfer">Transferência bancária</option><option value="Cash">Dinheiro</option><option value="MbWay">MB WAY</option><option value="Card">Cartão / Multibanco</option><option value="Other">Outro</option></AdaptiveSelect></label>
    {refund && <label>Motivo<input name="reason" required maxLength="2000" /></label>}
    {refund && <p>Pode ser devolvida uma parte do saldo. O montante não pode exceder o crédito disponível.</p>}
    </fieldset>
    {review && <><p>Valor recebido: <strong>{moneyText(currency(Number(review.get('amount'))))}</strong></p><p>Saldo: {moneyText(currency(participation?.balance ?? consultation?.balance))} <AppArrow direction="right" /> {moneyText(currency((participation?.balance ?? consultation?.balance ?? 0) + (settlesContribution ? 0 : Number(review.get('amount')))))}</p>{settlesContribution && <p>O recebimento define e liquida esta contribuição.</p>}<button type="button" className="secondary" disabled={disabled} onClick={() => setReview(null)}>Voltar atrás</button></>}
    <button disabled={disabled || !canSubmit}>{reviewBeforeSubmit && !review ? 'Rever antes de confirmar' : refund ? 'Confirmar devolução efetuada' : settlesContribution ? participation ? 'Confirmar recebimento e pagar participação' : 'Confirmar recebimento e pagar consulta' : 'Confirmar recebimento em crédito'}</button>
  </RecoveryForm>
}

export default function FinancePanel({ guard, disabled, submit, send, feedback, clearFeedback, perform, notify, open, instant, onOpenDomain }) {
  const [section, setSection] = useRecoveryState('view:' + 'finance' + ':section', 'Pending')
  const [page, setPage] = useState(1)
  const [client, setClient] = useState(null)
  const person = client?.id || ''
  const [filters, setFilters] = useState('')
  const [correction, setCorrection] = useState(null)
  const [correctingPrice, setCorrectingPrice] = useState(false)
  const key = `${section}|${person}|${page}|${filters}`
  const read = useCallback(signal => apiRequest(`consultations/finance?section=${section}&page=${page}${person ? '&personId=' + person : ''}${filters}`, undefined, { signal }), [section, person, page, filters])
  const showsMovements = ['Pending', 'OldDebts', 'Balances', 'Corrections'].includes(section)
  const resource = useLiveResource('finance', key, read, showsMovements)
  const result = resource.data
  const clients = useConsultationNames([...(result?.obligations || []), ...(result?.additionalObligations || [])], null, true)
  useEffect(() => {
    if (!result || resource.error || !['Pending', 'OldDebts', 'Balances', 'Corrections'].includes(section) || page <= Math.max(1, Math.ceil(result.total / 8))) return
    const correction = window.setTimeout(() => setPage(Math.max(1, Math.ceil(result.total / 8))), 0)
    return () => window.clearTimeout(correction)
  }, [result, resource.error, section, page])
  function change(next, nextClient) { guard(() => { if (nextClient !== undefined) setClient(nextClient); setSection(next); setPage(1); setCorrection(null) }) }
  return <section className={layout.page} aria-label="Área financeira">
    <div className={styles.tools}><SectionTabs label="Ações financeiras" columns={3} variant="tools" compactMobile value={section}
      items={[["Sales", "Vendas"], ["Expenses", "Despesas e investimentos"], ["Reports", "Relatórios financeiros"]].map(([id, label]) => ({ id, label }))} onChange={id => change(id)} /></div>
    <SectionTabs label="Separadores financeiros" compactMobile value={section} items={[["Pending", "Pendências financeiras"], ["OldDebts", "Dívidas antigas"], ["Balances", "Saldos e movimentos"], ["Corrections", "Correções financeiras"]].map(([id, label]) => ({ id, label }))}
      onChange={id => id === 'Balances' ? change(id, null) : change(id)} />
    {section === 'Sales' && <FinancialSalesPanel presentation="workspace" send={send} feedback={feedback} disabled={disabled} guard={guard} perform={perform} notify={notify} />}
    {section === 'Expenses' && <ExpensesPanel presentation="workspace" disabled={disabled} guard={guard} />}
    {section === 'Reports' && <FinancialReportsPanel presentation="workspace" disabled={disabled} origins={origins} movementKinds={names} />}
    {showsMovements && (resource.loading || resource.error) && <InformationCard cardId="finance-status" loading={resource.loading} error={resource.error} onRetry={resource.refresh} />}
    {showsMovements && <details className={layout.filter}><DisclosureSummary>Pesquisar movimentos e clientes</DisclosureSummary><form onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget); const q = new URLSearchParams()
      if (f.get('sort')) q.set('sort', f.get('sort'))
      setDateRangeParams(q, f.get('from'), f.get('to'))
      setFilters('&' + q.toString()); setPage(1)
    }}><h2>Pesquisa financeira</h2>
      <ClientSearch purpose="filter" selected={client} onSelect={value => { setClient(value); setPage(1) }} disabled={disabled} />
      <div className={layout.fields}><DateRangeFields type="date" startName="from" endName="to" startLabel="Desde" endLabel="Até" />
      <label>Ordenação<AdaptiveSelect name="sort"><option value="">Prioridade inicial</option><option value="Oldest">Mais antigas primeiro</option><option value="Newest">Mais recentes primeiro</option>{section === 'Balances' && !person && <option value="NameDescending">Clientes Z–A</option>}</AdaptiveSelect></label></div>
      <button>Pesquisar</button>
    </form></details>}
    {result && ['Pending', 'OldDebts', 'Balances', 'Corrections'].includes(section) && <SummaryCard variant="compact" cardId="finance-count" label={section === 'Pending' ? 'Pendências financeiras' : section === 'OldDebts' ? 'Dívidas antigas' : section === 'Corrections' ? 'Correções financeiras' : person ? 'Movimentos' : 'Saldos de clientes'} value={result.total} unit="registos" icon="wallet" />}
    {clients.error && <InformationCard error={clients.error} onRetry={clients.refresh} cardId="finance-client-names-error" />}
    {section === 'OldDebts' && result?.total === 0 && <InformationCard cardId="old-debts-empty"><p>Não há dívidas antigas nesta pesquisa.</p></InformationCard>}
    {section === 'Refund' && <InformationCard cardId="finance-refund"><FinancialEntryForm key={`Refund:${person}`} selectedClient={client} refund disabled={disabled} submit={submit} instant={instant} /></InformationCard>}
    {result && ['Pending', 'OldDebts'].includes(section) && <CardGrid layout="appointments">
      {(result.globalDebts || []).map(d => <InformationCard as="article" title="Saldo negativo por correção" cardId={'global-debt-' + d.personId} key={d.personId}
        footer={<ActionButton variant="tinted" onClick={() => change('Balances', { id: d.personId, data: { firstName: d.name } })}>Consultar saldo e movimentos</ActionButton>}>
        <p className={layout.status} data-typography="process-status">Dívida global</p><p>{d.name}</p><p className={layout.amount}>{moneyText(currency(d.amount))}</p><p className={layout.meta}>Dívida global, separada das consultas.</p>
        {['Failed', 'Uncertain'].includes(d.pushState) && <RecoveryForm recoveryKey={'finance-debt:' + d.personId} onSubmit={e => { if (!window.confirm('O envio anterior pode ter sido entregue. Autorizar outra tentativa pode repetir a notificação. Continuar?')) { e.preventDefault(); return } submit(e, () => ({ action: 'RetryBalancePush', id: d.noticeId })) }}><p>Notificação do dispositivo: {d.pushState === 'Uncertain' ? 'resultado por confirmar' : 'não submetida'}.</p><button className="secondary" disabled={disabled}>Autorizar nova tentativa de notificação</button></RecoveryForm>}
      </InformationCard>)}
      {result.obligations.map(c => <InformationCard as="article" title={c.serviceTitle} cardId={'obligation-' + c.id} key={c.id}
        footer={<ActionButton variant="tinted" onClick={() => open(c.id)}>Abrir operação financeira</ActionButton>}>
        <p className={layout.status} data-typography="process-status">{c.finalAmount === null && c.state === 'Performed' ? 'Contribuição pendente — Por definir' : c.state === 'Performed' ? 'Por pagar' : 'A aguardar recebimento'}</p>
        {c.personId && <p className={layout.meta}>{clients.data?.[c.personId] || (clients.loading ? 'A consultar o nome…' : 'Ficha de cliente')}</p>}
        <p className={layout.dataLine}><AppIcon name="calendar" /><span>{new Date(c.startsAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })}</span></p>
        <p className={layout.meta}>{c.state === 'Performed' ? 'Valor final' : 'Valor de referência'}: <strong className={layout.amount}>{moneyText(currency(c.state === 'Performed' ? c.finalAmount : c.referencePrice))}</strong></p>
        {c.paymentAlert && <p role="status" className={layout.meta}>Comunicação de pagamento do cliente</p>}
      </InformationCard>)}
      {section === 'Pending' && result.additionalObligations?.map(item => <InformationCard as="article" cardId={'domain-obligation-' + item.id} key={item.id} title={item.title}
        footer={<ActionButton variant="tinted" disabled={disabled} onClick={() => onOpenDomain(item.kind, item.resourceId)}>Abrir pagamento</ActionButton>}>
        <p className={layout.status} data-typography="process-status">{item.kind === 'Pack' ? 'Compra de pack por pagar' : 'Participação por pagar'}</p>
        {item.personId && <p className={layout.meta}>{clients.data?.[item.personId] || (clients.loading ? 'A consultar o nome…' : 'Ficha de cliente')}</p>}
        <p className={layout.amount}>{moneyText(currency(item.amount))}</p>
      </InformationCard>)}
    </CardGrid>}
    {section === 'Corrections' && <div className={layout.corrections}>
      <div className={layout.correctionForms}>
        <InformationCard title="Valor final de uma consulta" cardId="finance-price-correction"
          footer={<ActionButton variant="tinted" disabled={disabled} onClick={() => guard(() => { clearFeedback(); setCorrectingPrice(true) })}>Retificar valor de consulta</ActionButton>}>
          <p>Revê o efeito no valor por pagar e no saldo do cliente antes de confirmar.</p>
        </InformationCard>
        <InformationCard title="Registar correção excecional" cardId="finance-adjustment"><AdjustmentForm key="adjustment" selectedClient={client} disabled={disabled} submit={submit} showTitle={false} /></InformationCard>
      </div>
      {correctingPrice && <ConsultationPriceCorrectionDialog selectedClient={client} disabled={disabled} send={send} feedback={feedback}
        clearFeedback={clearFeedback} guard={guard} onClose={() => { clearFeedback(); setCorrectingPrice(false) }} />}
      <CardGrid layout="appointments">{result?.entries.map(e => <InformationCard as="article" title={names[e.kind]} cardId={'movement-' + e.id} key={e.id}
        footer={e.canReverseAdjustment && <ActionButton variant="tinted" onClick={() => setCorrection(e)}>Anular correção integralmente</ActionButton>}>
        <p>{e.name} · {moneyText(currency(e.amount))} · Saldo após movimento: {moneyText(currency(e.resultingBalance))}</p><p>{new Date(e.createdAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })} · {e.originalId && 'Origem: ' + e.originalId}</p><p>Justificação privada: {e.privateReason}</p>
      </InformationCard>)}</CardGrid>
      {correction && <RecoveryForm recoveryKey={'finance-adjustment-reversal:' + correction.id} data-protect-draft onSubmit={e => submit(e, f => ({ action: 'ReverseAdjustment', id: correction.id, reason: f.get('reason') }))}><h3>Compensação automática: {moneyText(currency(-correction.amount))}</h3><label>Justificação privada<textarea name="reason" required maxLength="2000" /></label><button disabled={disabled}>Confirmar anulação da correção</button><button type="button" className="secondary" onClick={() => setCorrection(null)}>Voltar</button></RecoveryForm>}
    </div>}
    {result && section === 'Balances' && (!person ? <InformationCard cardId="finance-customers">{result.customers.map(c => <div className={layout.customer} key={c.id}><ActionButton variant="text" onClick={() => { setClient({ id: c.id, data: { firstName: c.name } }); setPage(1) }}>{c.name}</ActionButton><strong className={layout.amount}>{moneyText(currency(c.balance))}</strong></div>)}</InformationCard> : <>
      <div className={layout.heading}><Heading level={2}>Saldo disponível: {moneyText(currency(result.balance))}</Heading><ActionButton variant="tinted" onClick={() => change('Refund')}>Registar devolução</ActionButton></div>
      <CardGrid layout="appointments">{result.entries.map(e => <InformationCard as="article" title={names[e.kind]} cardId={'movement-' + e.id} key={e.id}
        footer={(e.consultationId || e.canReverse) && <>{e.consultationId && <ActionButton variant="tinted" onClick={() => open(e.consultationId)}>Ver consulta</ActionButton>}{e.canReverse && <ActionButton variant="secondary" onClick={() => setCorrection(e)}>Anular movimento integralmente</ActionButton>}</>}>
        <p className={layout.amount}>{moneyText(currency(e.amount))}</p><p>Saldo após movimento: {moneyText(currency(e.resultingBalance))}</p><p>Efetivo: {new Date(e.effectiveAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })} · Registado: {new Date(e.createdAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })}</p><p>Origem: {origins[e.origin] || (e.origin === 'Correction' ? 'Correção excecional' : 'Registo anterior')} {e.originReference}</p>
      </InformationCard>)}</CardGrid>
      {correction && <RecoveryForm recoveryKey={'finance-receipt-reversal:' + correction.id} data-protect-draft onSubmit={e => submit(e, f => ({ action: correction.kind === 'Receipt' ? 'ReverseReceipt' : 'ReverseRefund', id: correction.id, reason: f.get('reason') }))}><h3>Anular {names[correction.kind]} · {moneyText(currency(correction.amount))}</h3><label>Motivo<input name="reason" required maxLength="2000" /></label><button disabled={disabled}>Confirmar anulação integral</button><button type="button" className="secondary" onClick={() => setCorrection(null)}>Voltar</button></RecoveryForm>}
    </>)}
    {['Pending', 'OldDebts', 'Balances', 'Corrections'].includes(section) && <Pagination total={result?.total} page={page} label="Páginas dos registos financeiros" onChange={setPage} />}
  </section>
}

function AdjustmentForm({ selectedClient, disabled, submit, showTitle = true }) {
  const [clientScope] = useState(selectedClient?.id || 'general')
  const [client, setClient] = useRecoveryState(`finance:adjustment:${clientScope}:client`, selectedClient)
  const person = client?.id || ''
  const [movements, setMovements] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!person) return
    let active = true
    async function load() {
      try {
        const all = []; let page = 1; let total
        do { const batch = await apiRequest(`consultations/finance?section=Balances&personId=${person}&page=${page++}`); total = batch.total; all.push(...batch.entries); if (!batch.entries.length) break } while (all.length < total)
        if (active) { setMovements(all); setError('') }
      } catch { if (active) setError('Não foi possível carregar os movimentos de origem. Podes voltar a selecionar o cliente ou registar sem referência.') }
    }
    load(); return () => { active = false }
  }, [person])
  return <RecoveryForm recoveryKey={'finance-adjustment:' + clientScope} recoveryScopes={['finance:adjustment:' + clientScope + ':']} data-protect-draft onSubmit={e => submit(e, f => {
    if (!person) throw new Error('Pesquisa e seleciona a ficha do cliente.')
    return { action: 'Adjustment', personId: person, amount: Number(f.get('amount')), id: f.get('original') || null, reason: f.get('reason') }
  })}>
    {showTitle && <h2>Registar correção excecional</h2>}
    <ClientSearch purpose="finance" ariaLabel="Cliente da correção" selected={client} disabled={disabled} onSelect={value => { setClient(value); setMovements([]); setError('') }} />
    <label>Valor da correção (com sinal)<input name="amount" type="number" step="0.01" min="-1000000" max="1000000" required /></label>
    <label>Movimento de origem (opcional)<AdaptiveSelect key={person} name="original" aria-label="Movimento de origem"><option value="">Sem ligação a outro movimento</option>{movements.map(e => <option key={e.id} value={e.id}>{names[e.kind] || 'Movimento'} · {moneyText(currency(e.amount))} · {new Date(e.createdAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })}</option>)}</AdaptiveSelect></label>
    {error && <p role="status">{error}</p>}
    <label>Justificação privada<textarea name="reason" required maxLength="2000" /></label>
    <p>Um valor negativo reduz o saldo e pode criar dívida global. Não altera consultas já pagas ou sem dívida.</p>
    <button disabled={disabled || !person}>Confirmar correção financeira</button>
  </RecoveryForm>
}

