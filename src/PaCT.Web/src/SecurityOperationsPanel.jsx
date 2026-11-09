import { useCallback, useState } from 'react'
import ActionButton from './ActionButton'
import CardGrid from './CardGrid'
import ClientSecurityHistoryPanel from './ClientSecurityHistoryPanel'
import Heading from './Heading'
import InformationCard from './InformationCard'
import SummaryCard from './SummaryCard'
import SecurityAuditPanel from './SecurityAuditPanel'
import useLiveResource from './useLiveResource'
import { apiRequest } from './identityApi'
import { showSuccess } from './actionNotices'
import { agendaDate } from './agendaTime'
import styles from './SecurityOperationsPanel.module.css'

const transportLabels = { Available: 'Disponível', Unavailable: 'Indisponível' }
const workerLabels = { Active: 'Ativo', Stale: 'Sem atividade recente', Unknown: 'Sem informação', Unavailable: 'Indisponível' }
const queueLabels = { Pending: 'Pendente', Sending: 'Em envio', Submitted: 'Aceite pelo SMTP', Failed: 'Falhou', Uncertain: 'Por confirmar', Cancelled: 'Cancelado' }

export default function SecurityOperationsPanel({ guard, disabled }) {
  const [view, setView] = useState('events')

  return <section className={styles.panel} aria-labelledby="security-operations-title">
    <header className={styles.intro}>
      <Heading level={2} id="security-operations-title">Auditoria de segurança</Heading>
      <p>Consulta os eventos da aplicação, o histórico de acesso por cliente e o estado dos emails de segurança.</p>
    </header>
    <nav className={styles.views} aria-label="Vistas da auditoria">
      <ActionButton variant={view === 'events' ? 'primary' : 'secondary'} aria-pressed={view === 'events'} disabled={disabled}
        onClick={() => guard(() => setView('events'))}>Registos de segurança</ActionButton>
      <ActionButton variant={view === 'history' ? 'primary' : 'secondary'} aria-pressed={view === 'history'} disabled={disabled}
        onClick={() => guard(() => setView('history'))}>Histórico por cliente</ActionButton>
      <ActionButton variant={view === 'email' ? 'primary' : 'secondary'} aria-pressed={view === 'email'} disabled={disabled}
        onClick={() => guard(() => setView('email'))}>Operações de email</ActionButton>
    </nav>
    <div hidden={view !== 'events'}><SecurityAuditPanel active={view === 'events'} disabled={disabled} /></div>
    <div hidden={view !== 'history'}><ClientSecurityHistoryPanel active={view === 'history'} disabled={disabled} /></div>
    {view === 'email' && <EmailOperationsPanel guard={guard} disabled={disabled} />}
  </section>
}

function EmailOperationsPanel({ guard, disabled }) {
  const read = useCallback(signal => apiRequest('identity/email-operations', undefined, { signal }), [])
  const resource = useLiveResource('securityEmailOperations', 'current', read)
  const [reviewing, setReviewing] = useState(null)
  const [error, setError] = useState('')
  const data = resource.data
  const unavailable = disabled || resource.loading || resource.refreshing || reviewing !== null

  function review(item) {
    guard(async () => {
      setError('')
      setReviewing(item.id)
      try {
        const result = await apiRequest(`identity/email-operations/${item.id}/review`, {})
        showSuccess(result.message, `security-email-review:${item.id}`)
      } catch (failure) {
        setError(failure.message)
      } finally {
        setReviewing(null)
      }
    })
  }

  return <section className={styles.panel} aria-label="Operações de email de segurança" data-pending-command={reviewing !== null || undefined}>
    {error && <p className="notice error" role="alert">{error}</p>}

    {data && <CardGrid className={styles.metrics}>
          <SummaryCard cardId="security-transport-status" label="Transporte de email" value={transportLabels[data.transport.status] || data.transport.status} icon="settings" />
          <SummaryCard cardId="security-worker-status" label="Worker de envio" value={workerLabels[data.worker.status] || data.worker.status} icon="clock" />
    </CardGrid>}
    <InformationCard title="Estado do serviço" headingLevel={3} cardId="security-operations-status"
      loading={resource.loading} refreshing={resource.refreshing} error={resource.error} onRetry={resource.refresh}>
      {data &&
        <dl className={styles.details}>
          <div><dt>Última verificação da configuração</dt><dd>{agendaDate(data.transport.lastCheckedAt)}</dd></div>
          <div><dt>Última atividade do worker</dt><dd>{agendaDate(data.worker.lastActivityAt)}</dd></div>
          <div><dt>Último resultado do worker</dt><dd>{data.worker.lastOutcomeState ? `${queueLabels[data.worker.lastOutcomeState] || data.worker.lastOutcomeState} · ${agendaDate(data.worker.lastOutcomeAt)}` : 'Ainda não registado'}</dd></div>
          {data.worker.failureCategory && <div><dt>Última falha técnica</dt><dd>{data.worker.failureCategory} · {agendaDate(data.worker.lastFailureAt)}</dd></div>}
        </dl>
      }
    </InformationCard>

    {data && <InformationCard title="Fila de emails de segurança" headingLevel={3} cardId="security-email-queue">
      <dl className={`${styles.details} ${styles.queueCounts}`}>
        {Object.entries(queueLabels).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{data.queue[key.toLowerCase()]}</dd></div>)}
      </dl>
      <p className="field-help">O estado «Aceite pelo SMTP» indica aceitação pelo servidor de envio. A entrega ao destinatário fica por confirmar.</p>
    </InformationCard>}

    {data && <InformationCard title="Envios por confirmar" headingLevel={3} cardId="security-uncertain-items">
      {data.queue.uncertainItems.length === 0
        ? <p>Não existem envios por confirmar.</p>
        : <><p className="field-help">Registar uma revisão confirma a análise e mantém o estado do envio.</p>
          <ol className={styles.queue}>
          {data.queue.uncertainItems.map(item => <li key={item.id} className={styles.queueItem}>
            <div><strong>Registo técnico {item.id}</strong><span>Atualizado em {agendaDate(item.updatedAt)} · {item.reviewCount} {item.reviewCount === 1 ? 'revisão' : 'revisões'}</span></div>
            <ActionButton variant="secondary" disabled={unavailable || data.policy.reviewActionAvailable !== true} onClick={() => review(item)}>Registar revisão</ActionButton>
          </li>)}
        </ol></>}
    </InformationCard>}
  </section>
}
