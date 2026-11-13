import DisclosureSummary from './DisclosureSummary'
import { useCallback, useId, useState } from 'react'
import ActionButton from './ActionButton'
import AdaptiveSelect from './AdaptiveSelect'
import CardGrid from './CardGrid'
import Heading from './Heading'
import InformationCard from './InformationCard'
import Pagination from './Pagination'
import SummaryCard from './SummaryCard'
import useLiveResource from './useLiveResource'
import { apiRequest } from './identityApi'
import { agendaDate } from './agendaTime'
import styles from './SecurityAuditPanel.module.css'

const eventLabels = {
  LoginSucceeded: 'Entrada concluída', LoginFailed: 'Entrada recusada', AuthenticationRequired: 'Sessão necessária',
  AccessDenied: 'Acesso proibido', RateLimitExceeded: 'Limite excedido', SensitiveDataRead: 'Leitura autorizada',
  EmailFailed: 'Email falhou', EmailUncertain: 'Email por confirmar', EmailWorkerError: 'Erro do worker',
  EmailReviewRecorded: 'Revisão de email', InternalError: 'Erro interno'
}
const outcomeLabels = { Success: 'Sucesso', Failure: 'Falha', Denied: 'Proibido', Blocked: 'Bloqueado', Uncertain: 'Incerto', Error: 'Erro' }
const severityLabels = { Info: 'Informativo', Warning: 'Atenção', High: 'Elevado', Critical: 'Crítico' }
const roleLabels = { TechnicalManager: 'Gestor técnico', TherapistManager: 'Gestora-terapeuta', Client: 'Cliente' }
const detailLabels = {
  authorized_read: 'Leitura autorizada de dados protegidos.', credentials_rejected: 'As credenciais não foram aceites.',
  factor_rejected: 'O segundo fator não foi aceite.', authentication_required: 'Foi necessário iniciar sessão.',
  authorization_denied: 'A sessão não tinha autorização para esta operação.', rate_limit_exceeded: 'O limite temporário impediu o pedido.',
  failed: 'O transporte de email devolveu uma falha.', uncertain: 'O resultado do transporte de email não pôde ser confirmado.',
  configuration: 'O worker encontrou um problema de configuração.', worker: 'O worker encontrou um erro de processamento.',
  duplicate: 'A revisão já tinha sido registada.', review: 'A revisão foi registada pela gestão.',
  unhandled_exception: 'O pedido terminou com erro interno e tem um identificador técnico.'
}

const emptyFilters = { eventType: '', outcome: '' }
const checkTime = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', dateStyle: 'short', timeStyle: 'medium' })

export default function SecurityAuditPanel({ active, disabled }) {
  const [filters, setFilters] = useState(emptyFilters)
  const [draft, setDraft] = useState(filters)
  const [page, setPage] = useState(1)
  const [showVerification, setShowVerification] = useState(false)
  const verificationId = useId()
  const params = new URLSearchParams({ page: String(page) })
  if (filters.eventType) params.set('eventType', filters.eventType)
  if (filters.outcome) params.set('outcome', filters.outcome)
  const query = params.toString()
  const read = useCallback(async signal => {
    const result = await apiRequest(`identity/security-audit?${query}`, undefined, { signal })
    if (result?.state !== 'NotPrepared' && (!result?.summary || !Array.isArray(result.items))) {
      throw new Error('A aplicação devolveu uma resposta inválida para os registos de segurança.')
    }
    return { ...result, checkedAt: Date.now() }
  }, [query])
  const resource = useLiveResource('securityAudit', query, read, active)
  const notPrepared = resource.data?.state === 'NotPrepared'
  const data = notPrepared ? null : resource.data
  const unavailable = disabled || resource.loading
  const canApply = draft.eventType !== filters.eventType || draft.outcome !== filters.outcome
  const hasFilters = filters.eventType || filters.outcome || draft.eventType || draft.outcome

  function submit(event) {
    event.preventDefault()
    if (unavailable || !canApply) return
    setFilters(draft)
    setPage(1)
  }

  function clear() {
    setDraft(emptyFilters)
    setFilters(emptyFilters)
    setPage(1)
  }

  function verifyAvailability() {
    setShowVerification(true)
    resource.refresh()
  }

  if (notPrepared) return <InformationCard title="Auditoria por preparar" headingLevel={3}
    cardId="security-audit-not-prepared" error={showVerification ? '' : resource.error}>
    <p>A recolha de eventos começa após a preparação da auditoria nesta instalação.</p>
    <ActionButton className={styles.retry} variant="secondary" disabled={disabled || resource.refreshing}
      aria-expanded={showVerification} aria-controls={verificationId}
      onClick={verifyAvailability}>{resource.refreshing ? 'A verificar…' : 'Verificar disponibilidade'}</ActionButton>
    <div id={verificationId} hidden={!showVerification}>
      {showVerification && <VerificationResult resource={resource} />}
    </div>
  </InformationCard>

  return <section className={styles.audit} aria-label="Registos de segurança">
    {showVerification && data && <VerificationResult resource={resource} />}
    {data && <CardGrid className={styles.metrics}>
      <SummaryCard cardId="security-audit-total" label="Registos encontrados" value={data.summary.total} icon="tasks" />
      <SummaryCard cardId="security-audit-recent" label="Últimas 24 horas" value={data.summary.last24Hours} icon="clock" />
      <SummaryCard cardId="security-audit-attention" label="A exigir atenção" value={data.summary.attention} icon="warning" />
      <SummaryCard cardId="security-audit-reads" label="Leituras protegidas" value={data.summary.sensitiveReads} icon="people" />
    </CardGrid>}
    <InformationCard title="Eventos recentes" headingLevel={3} cardId="security-audit-events" loading={resource.loading}
      refreshing={resource.refreshing} error={resource.error} onRetry={resource.refresh}>
      {(data || resource.loading && !resource.error) && <form className={styles.filters} onSubmit={submit}>
        <label>Tipo de evento
          <AdaptiveSelect value={draft.eventType} disabled={disabled} onChange={event => setDraft(current => ({ ...current, eventType: event.target.value }))}>
            <option value="">Todos os eventos</option>
            {(data?.filters?.eventTypes || Object.keys(eventLabels)).map(value => <option key={value} value={value}>{eventLabels[value] || value}</option>)}
          </AdaptiveSelect>
        </label>
        <label>Resultado
          <AdaptiveSelect value={draft.outcome} disabled={disabled} onChange={event => setDraft(current => ({ ...current, outcome: event.target.value }))}>
            <option value="">Todos os resultados</option>
            {(data?.filters?.outcomes || Object.keys(outcomeLabels)).map(value => <option key={value} value={value}>{outcomeLabels[value] || value}</option>)}
          </AdaptiveSelect>
        </label>
        <ActionButton type="submit" disabled={unavailable || !canApply}>Aplicar filtros</ActionButton>
        {hasFilters && <ActionButton variant="secondary" disabled={unavailable} onClick={clear}>Limpar</ActionButton>}
      </form>}
      {data && (data.items.length > 0
        ? <ol className={styles.timeline}>{data.items.map(item => <AuditEvent key={item.id} item={item} />)}</ol>
        : <p>{data.total > 0 ? 'A atualizar a página de resultados…' : filters.eventType || filters.outcome
          ? 'Não existem eventos para os filtros selecionados.' : 'Ainda não foram registados eventos de segurança.'}</p>)}
      {data && <Pagination total={data.total} page={data.page} pageSize={data.pageSize} correctPage={!resource.error}
        onChange={setPage} disabled={unavailable} label="Páginas da auditoria de segurança" />}
    </InformationCard>
  </section>
}

function VerificationResult({ resource }) {
  const headingId = useId()
  const { data, error, refreshing } = resource
  const notPrepared = data.state === 'NotPrepared'
  const failed = !refreshing && !!error
  let outcome = 'A leitura dos registos técnicos está disponível.'
  if (refreshing) outcome = 'A consultar a disponibilidade da auditoria…'
  else if (failed) outcome = 'Não foi possível confirmar o estado da auditoria.'
  else if (notPrepared) outcome = 'A API respondeu. A auditoria continua por preparar.'
  const tone = refreshing ? '' : failed ? 'error' : notPrepared ? 'review-alert' : 'success'

  return <section className={`notice ${tone} ${styles.verification}`} aria-labelledby={headingId}>
    <Heading level={4} id={headingId}>Resultado da verificação</Heading>
    <p role="status"><strong>{outcome}</strong></p>
    <dl className={styles.details}>
      <div><dt>O que foi verificado</dt><dd>Pedido de leitura dos registos técnicos à API.</dd></div>
      {!refreshing && (failed ? <div><dt>Detalhe</dt><dd>{error}</dd></div>
        : <div><dt>Resposta recebida</dt><dd>{checkTime.format(data.checkedAt)}</dd></div>)}
      {!refreshing && !failed && notPrepared && <div><dt>Próximo passo</dt><dd>O responsável da instalação precisa de preparar a tabela de auditoria. Depois, volta a verificar.</dd></div>}
    </dl>
  </section>
}

function AuditEvent({ item }) {
  return <li className={styles.event}>
    <div className={styles.eventHeader}>
      <strong>{eventLabels[item.type] || item.type}</strong>
      <time dateTime={item.occurredAt}>{agendaDate(item.occurredAt)}</time>
    </div>
    <div className={styles.meta}>
      <span className={`${styles.badge} ${styles['badge' + item.severity] || ''}`}>{severityLabels[item.severity] || item.severity}</span>
      <span>{outcomeLabels[item.outcome] || item.outcome}</span>
      {item.actorRole && <span>{roleLabels[item.actorRole] || item.actorRole}</span>}
    </div>
    <details>
      <DisclosureSummary>Detalhes técnicos</DisclosureSummary>
      <p>{detailLabels[item.detail] || item.detail || 'Evento técnico registado.'}</p>
      <dl className={styles.details}>
        {item.actorAccountId && <div><dt>Conta</dt><dd><code>{item.actorAccountId}</code></dd></div>}
        {item.route && <div><dt>Rota</dt><dd><code>{item.route}</code></dd></div>}
        {item.method && <div><dt>Método</dt><dd><code>{item.method}</code>{item.statusCode ? ` · HTTP ${item.statusCode}` : ''}</dd></div>}
        {item.requestId && <div><dt>Identificador do pedido</dt><dd><code>{item.requestId}</code></dd></div>}
        {item.resourceId && <div><dt>Recurso</dt><dd><code>{item.resourceId}</code></dd></div>}
      </dl>
    </details>
  </li>
}
