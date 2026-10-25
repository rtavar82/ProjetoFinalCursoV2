import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import useClientOptions from './useClientOptions'
import InformationCard from './InformationCard'
import CardGrid from './CardGrid'
import styles from './FinancePanel.module.css'

const currency = value => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value ?? 0)
const names = { Receipt: 'Recebimento', Refund: 'Devolução', Settlement: 'Liquidação', Restitution: 'Reposição de valor do retiro', Reversal: 'Anulação / movimento compensatório', Adjustment: 'Correção financeira', AdjustmentReversal: 'Anulação de correção' }
const origins = { GeneralCredit: 'Crédito geral', Consultation: 'Consulta/pedido', Sale: 'Venda', EventService: 'Evento/serviço', Pack: 'Compra de pack' }
const measures = { received: 'Total recebido (dinheiro confirmado)', corrections: 'Correções e compensações (valor assinado)', globalNegativeDebt: 'Dívida global por saldo negativo', refunded: 'Total devolvido (registos de dinheiro)', settled: 'Crédito utilizado em liquidações', availableBalance: 'Crédito disponível (saldos positivos)', netBalance: 'Saldo global líquido', activeCollectionAmount: 'Cobranças ativas', closedCollectionAmount: 'Cobranças encerradas sem pagamento', totalUnpaid: 'Total conhecido ainda não pago' }
const counts = { paidConsultations: 'Consultas pagas', unpaidConsultations: 'Consultas por pagar', pendingContributions: 'Contribuições pendentes', undefinedContributions: 'Contribuições sem montante definido', noDebtConsultations: 'Consultas sem dívida', freeConsultations: 'Consultas gratuitas', giftConsultations: 'Consultas oferecidas', packConsultations: 'Consultas cobertas por pack' }

export function FinancialEntryForm({ people, personId = '', consultation = null, refund = false, disabled, submit, instant }) {
  const [person, setPerson] = useState(consultation?.personId || personId)
  const [origin, setOrigin] = useState(consultation ? 'Consultation' : 'GeneralCredit')
  const [options, setOptions] = useState([])
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    if (consultation || !person || !['Consultation', 'Pack'].includes(origin)) return
    let active = true
    async function load() {
      try {
        const all = []; let page = 1; let total
        do { const batch = await apiRequest(origin === 'Pack' ? `consultations/packs?scope=History&personId=${person}&page=${page++}` : `consultations?search=true&personId=${person}&page=${page++}`); total = batch.total; all.push(...batch.items) } while (all.length < total)
        if (active) { setOptions(all); setLoadError('') }
      } catch { if (active) setLoadError(origin === 'Pack' ? 'Não foi possível carregar as compras de packs. Volta a selecionar o cliente.' : 'Não foi possível carregar as consultas. Volta a selecionar o cliente.') }
    }
    load(); return () => { active = false }
  }, [person, origin, consultation])
  return <form data-protect-draft onSubmit={e => submit(e, f => {
    const linked = consultation || options.find(c => c.id === f.get('consultation'))
    return { action: refund ? 'Refund' : 'Receipt', personId: person, id: origin === 'Consultation' && !refund ? linked?.id : undefined,
      version: linked?.version, origin: refund ? undefined : origin, originReference: f.get('reference'), amount: Number(f.get('amount')), startsAt: instant(f.get('effective')), method: f.get('method'), reason: f.get('reason') }
  })}>
    <h3>{refund ? 'Registar devolução efetuada' : 'Registar recebimento confirmado'}</h3>
    <label>Cliente<select aria-label="Cliente" required disabled={!!consultation} value={person} onChange={e => { setPerson(e.target.value); setOptions([]) }}><option value="">Seleciona o cliente</option>{people.map(p => <option key={p.id} value={p.id}>{[p.data.firstName, p.data.lastName].filter(Boolean).join(' ')}</option>)}</select></label>
    {!refund && <><label>Origem<select value={origin} disabled={!!consultation} onChange={e => setOrigin(e.target.value)}>{Object.entries(origins).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      {origin === 'Consultation' && !consultation && <label>Consulta/pedido<select name="consultation" required><option value="">Seleciona a origem</option>{options.map(c => <option key={c.id} value={c.id}>{c.serviceTitle} · {new Date(c.startsAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })}</option>)}</select></label>}
      {['Sale', 'EventService'].includes(origin) && <label>Referência da origem<input name="reference" required maxLength="120" /></label>}</>}
    {!refund && origin === 'Pack' && <label>Compra de pack<select name="reference" required defaultValue=""><option value="">Seleciona a compra</option>{options.map(p => <option key={p.id} value={p.id}>{p.title} · {currency(p.amount)}</option>)}</select></label>}
    {loadError && <p role="alert">{loadError}</p>}
    <label>Valor efetivo<input name="amount" type="number" required min="0.01" step="0.01" defaultValue={consultation?.finalAmount ?? consultation?.referencePrice ?? ''} /></label>
    <label>Data e hora efetivas (Lisboa)<input name="effective" type="datetime-local" required /></label>
    <label>Método<select name="method"><option value="Transfer">Transferência bancária</option><option value="Cash">Dinheiro</option><option value="MbWay">MB WAY</option><option value="Card">Cartão / Multibanco</option><option value="Other">Outro</option></select></label>
    {refund && <label>Motivo<input name="reason" required maxLength="2000" /></label>}
    <p>{refund ? 'Pode ser devolvida uma parte do saldo. O montante não pode exceder o crédito disponível.' : origin === 'Pack' ? 'Este registo acrescenta crédito. O pagamento da compra é confirmado em separado.' : 'Este registo acrescenta crédito. Não paga automaticamente uma consulta.'}</p>
    <button disabled={disabled || !!loadError}>{refund ? 'Confirmar devolução efetuada' : 'Confirmar recebimento em crédito'}</button>
  </form>
}

export default function FinancePanel({ guard, disabled, submit, open, instant, onOpenDomain }) {
  const [section, setSection] = useState('Pending')
  const [page, setPage] = useState(1)
  const [person, setPerson] = useState('')
  const [filters, setFilters] = useState('')
  const [correction, setCorrection] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const customers = useClientOptions(filtersOpen || ['Receipt', 'Refund', 'Corrections'].includes(section))
  const people = customers.data || []
  const key = `${section}|${person}|${page}|${filters}`
  const read = useCallback(signal => {
    const endpoint = section === 'Reports' ? 'consultations/reports' : 'consultations/finance'
    return apiRequest(`${endpoint}?section=${section}&page=${page}${person ? '&personId=' + person : ''}${filters}`, undefined, { signal })
  }, [section, person, page, filters])
  const resource = useLiveResource('finance', key, read, !['Receipt', 'Refund'].includes(section))
  const result = resource.data
  function change(next, nextPerson) { guard(() => { if (nextPerson !== undefined) setPerson(nextPerson); setSection(next); setPage(1); setCorrection(null) }) }
  return <>
    {customers.error && <InformationCard cardId="finance-customer-options" error={customers.error} onRetry={customers.refresh} />}
    <nav className="consultation-tabs" aria-label="Ações financeiras"><button className="secondary" onClick={() => change('Receipt')}>Registar recebimento</button><button className="secondary" onClick={() => change('Reports')}>Relatórios financeiros</button></nav>
    <nav className="consultation-tabs" aria-label="Separadores financeiros"><button className={section === 'Pending' ? '' : 'secondary'} aria-pressed={section === 'Pending'} onClick={() => change('Pending')}>Pendências financeiras</button><button className={section === 'Balances' ? '' : 'secondary'} aria-pressed={section === 'Balances'} onClick={() => change('Balances', '')}>Saldos e movimentos</button><button className={section === 'Corrections' ? '' : 'secondary'} aria-pressed={section === 'Corrections'} onClick={() => change('Corrections')}>Correções financeiras</button></nav>
    {!['Receipt', 'Refund'].includes(section) && (resource.loading || resource.error) && <InformationCard cardId="finance-status" loading={resource.loading} error={resource.error} onRetry={resource.refresh} />}
    {!['Receipt', 'Refund'].includes(section) && <details className={styles.filters} onToggle={event => setFiltersOpen(event.currentTarget.open)}><summary>{section === 'Reports' ? 'Filtrar o relatório' : 'Pesquisar movimentos e clientes'}</summary><form onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget); const q = new URLSearchParams()
      for (const field of ['term', 'sort', 'origin', 'kind']) if (f.get(field)) q.set(field, f.get(field))
      if (f.get('from')) q.set('from', instant(f.get('from')))
      if (f.get('to')) q.set('to', instant(f.get('to')))
      setFilters('&' + q.toString()); setPage(1); setPerson(f.get('person'))
    }}><h2>{section === 'Reports' ? 'Relatórios financeiros' : 'Pesquisa financeira'}</h2>
      <label>Cliente<select name="person" value={person} onChange={e => { setPerson(e.target.value); setPage(1) }}><option value="">Todos os clientes</option>{people.map(p => <option key={p.id} value={p.id}>{[p.data.firstName, p.data.lastName].join(' ')}</option>)}</select></label>
      <label>Nome do cliente<input name="term" /></label><label>Desde (Lisboa)<input name="from" type="datetime-local" /></label><label>Até, exclusivo (Lisboa)<input name="to" type="datetime-local" /></label>
      {section === 'Reports' ? <><label>Origem dos movimentos<select name="origin"><option value="">Todas</option>{Object.entries(origins).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Tipo de movimento<select name="kind"><option value="">Todos</option>{Object.entries(names).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></> : <><label>Ordenação<select name="sort"><option value="">Prioridade inicial</option><option value="Oldest">Mais antigas primeiro</option><option value="Newest">Mais recentes primeiro</option>{section === 'Balances' && !person && <option value="NameDescending">Clientes Z–A</option>}</select></label></>}
      <button>Pesquisar</button>
    </form></details>}
    {['Receipt', 'Refund'].includes(section) && <div className="record-panel"><FinancialEntryForm key={`${section}:${person}`} people={people} personId={person} refund={section === 'Refund'} disabled={disabled} submit={submit} instant={instant} /></div>}
    {result && section === 'Pending' && <CardGrid>{(result.globalDebts || []).map(d => <InformationCard as="article" cardId={'global-debt-' + d.personId} key={d.personId}><h2>Saldo negativo por correção</h2><p>{d.name} · {currency(d.amount)}</p><p>Dívida global, separada das consultas.</p>{['Failed', 'Uncertain'].includes(d.pushState) && <form onSubmit={e => { if (!window.confirm('O envio anterior pode ter sido entregue. Autorizar outra tentativa pode repetir a notificação. Continuar?')) { e.preventDefault(); return } submit(e, () => ({ action: 'RetryBalancePush', id: d.noticeId })) }}><p>Notificação do dispositivo: {d.pushState === 'Uncertain' ? 'resultado por confirmar' : 'não submetida'}.</p><button className="secondary" disabled={disabled}>Autorizar nova tentativa de notificação</button></form>}<button onClick={() => change('Balances', d.personId)}>Consultar saldo e movimentos</button></InformationCard>)}{result.obligations.map(c => <InformationCard as="article" cardId={'obligation-' + c.id} key={c.id}><h2>{c.serviceTitle}</h2><p>{c.collectionClosed ? 'Por pagar — Cobrança encerrada' : c.finalAmount === null && c.state === 'Performed' ? 'Contribuição pendente — Por definir' : c.state === 'Performed' ? 'Por pagar' : 'A aguardar recebimento'}</p><p>{new Date(c.startsAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })}</p>{c.paymentAlert && <p role="status">Comunicação de pagamento do cliente</p>}<button onClick={() => open(c.id)}>Abrir operação financeira</button></InformationCard>)}</CardGrid>}
    {section === 'Pending' && result?.additionalObligations?.map(item => <InformationCard as="article" cardId={'domain-obligation-' + item.id} key={item.id} title={item.title}><p>{item.kind === 'Pack' ? 'Compra de pack por pagar' : 'Participação por pagar'} · {currency(item.amount)}</p><button disabled={disabled} onClick={() => onOpenDomain(item.kind, item.resourceId)}>Abrir pagamento</button></InformationCard>)}
    {section === 'Corrections' && <div className="record-panel"><AdjustmentForm key="adjustment" people={people} personId={person} disabled={disabled} submit={submit} />
      {result?.entries.map(e => <InformationCard as="article" cardId={'movement-' + e.id} key={e.id}><h3>{names[e.kind]}</h3><p>{e.name} · {currency(e.amount)} · Saldo após movimento: {currency(e.resultingBalance)}</p><p>{new Date(e.createdAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })} · {e.originalId && 'Origem: ' + e.originalId}</p><p>Justificação privada: {e.privateReason}</p>{e.canReverseAdjustment && <button className="secondary" onClick={() => setCorrection(e)}>Anular correção integralmente</button>}</InformationCard>)}
      {correction && <form data-protect-draft onSubmit={e => submit(e, f => ({ action: 'ReverseAdjustment', id: correction.id, reason: f.get('reason') }))}><h3>Compensação automática: {currency(-correction.amount)}</h3><label>Justificação privada<textarea name="reason" required maxLength="2000" /></label><button disabled={disabled}>Confirmar anulação da correção</button><button type="button" className="secondary" onClick={() => setCorrection(null)}>Voltar</button></form>}</div>}
    {result && section === 'Balances' && <div className="record-panel">{!person ? result.customers.map(c => <p key={c.id}><button className="text-button" onClick={() => { setPerson(c.id); setPage(1) }}>{c.name}</button> · {currency(c.balance)}</p>) : <><h2>Saldo disponível: {currency(result.balance)}</h2><div className="consultation-tabs"><button onClick={() => change('Receipt')}>Registar recebimento</button><button className="secondary" onClick={() => change('Refund')}>Registar devolução</button></div>{result.entries.map(e => <InformationCard as="article" cardId={'movement-' + e.id} key={e.id}><p>{names[e.kind]} · {currency(e.amount)} · Saldo após movimento: {currency(e.resultingBalance)}</p><p>Efetivo: {new Date(e.effectiveAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })} · Registado: {new Date(e.createdAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })}</p><p>Origem: {origins[e.origin] || (e.origin === 'Correction' ? 'Correção excecional' : 'Registo anterior')} {e.originReference}</p>{e.consultationId && <button className="text-button" onClick={() => open(e.consultationId)}>Ver consulta</button>}{e.canReverse && <button className="secondary" onClick={() => setCorrection(e)}>Anular movimento integralmente</button>}</InformationCard>)}
      {correction && <form data-protect-draft onSubmit={e => submit(e, f => ({ action: correction.kind === 'Receipt' ? 'ReverseReceipt' : 'ReverseRefund', id: correction.id, reason: f.get('reason') }))}><h3>Anular {names[correction.kind]} · {currency(correction.amount)}</h3><label>Motivo<input name="reason" required maxLength="2000" /></label><button disabled={disabled}>Confirmar anulação integral</button><button type="button" className="secondary" onClick={() => setCorrection(null)}>Voltar</button></form>}</>}</div>}
    {result && section === 'Reports' && <div className="record-panel"><p>{result.description}</p><p>Apuramento: {new Date(result.asOf).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })}</p>{Object.entries(measures).map(([k, text]) => <p key={k}>{text}: <strong>{currency(result[k])}</strong></p>)}{Object.entries(counts).map(([k, text]) => <p key={k}>{text}: <strong>{result[k]}</strong></p>)}{result.legacyReceiptDates > 0 && <p>Existem recebimentos anteriores sem distinção entre data efetiva e data de validação. Não foi inventada uma data histórica.</p>}</div>}
    {['Pending', 'Balances', 'Corrections'].includes(section) && result && <div className="consultation-tabs"><p>{result.total} registos · Página {page}</p><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</button><button disabled={page * 8 >= result.total} onClick={() => setPage(p => p + 1)}>Seguinte</button></div>}
  </>
}

function AdjustmentForm({ people, personId, disabled, submit }) {
  const [person, setPerson] = useState(personId)
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
  return <form data-protect-draft onSubmit={e => submit(e, f => ({ action: 'Adjustment', personId: person, amount: Number(f.get('amount')), id: f.get('original') || null, reason: f.get('reason') }))}>
    <h2>Registar correção excecional</h2>
    <label>Cliente<select name="person" aria-label="Cliente da correção" required value={person} onChange={e => { setPerson(e.target.value); setMovements([]) }}><option value="">Seleciona o cliente</option>{people.map(p => <option key={p.id} value={p.id}>{[p.data.firstName, p.data.lastName].join(' ')}</option>)}</select></label>
    <label>Valor da correção (com sinal)<input name="amount" type="number" step="0.01" min="-1000000" max="1000000" required /></label>
    <label>Movimento de origem (opcional)<select name="original" aria-label="Movimento de origem"><option value="">Sem ligação a outro movimento</option>{movements.map(e => <option key={e.id} value={e.id}>{names[e.kind] || 'Movimento'} · {currency(e.amount)} · {new Date(e.createdAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })}</option>)}</select></label>
    {error && <p role="status">{error}</p>}
    <label>Justificação privada<textarea name="reason" required maxLength="2000" /></label>
    <p>Um valor negativo reduz o saldo e pode criar dívida global. Não altera consultas já pagas ou sem dívida.</p>
    <button disabled={disabled}>Confirmar correção financeira</button>
  </form>
}

