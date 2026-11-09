import { useCallback, useState } from 'react'
import ClientSearch from './ClientSearch'
import InformationCard from './InformationCard'
import useLiveResource from './useLiveResource'
import { apiRequest } from './identityApi'
import { agendaDate } from './agendaTime'
import styles from './SecurityAuditPanel.module.css'

const actionLabels = {
  ChangeEmail: 'Alteração do email de acesso',
  ChangePassword: 'Alteração da palavra-passe',
  RecoverPassword: 'Recuperação da palavra-passe',
  ResetPasskeys: 'Reposição das Passkeys',
  LinkGoogle: 'Associação da conta Google',
  UnlinkGoogle: 'Desassociação da conta Google',
}

const statusLabels = {
  Pending: 'Pendente',
  Confirmed: 'Confirmada',
  Superseded: 'Substituída',
  Applied: 'Aplicada',
  Expired: 'Expirada',
}

function hasActiveAccount(person) {
  return person.hasAccount && person.accountState === 'Active'
}

function authorLabel(authorId, accountId) {
  if (!authorId) return 'Sistema'
  return authorId === accountId ? 'Cliente' : 'Gestão'
}

export default function ClientSecurityHistoryPanel({ active, disabled }) {
  const [client, setClient] = useState(null)
  const path = client ? `clients/${client.id}/access` : ''
  const read = useCallback(async signal => {
    const result = await apiRequest(path, undefined, { signal })
    if (!Array.isArray(result?.history)) throw new Error('Não foi possível confirmar o histórico de segurança desta conta.')
    return { accountId: result.accountId, history: result.history }
  }, [path])
  const resource = useLiveResource('clientAccess', 'history:' + path, read, active && !!path)

  return <section className={styles.audit} aria-label="Histórico de segurança por cliente">
    <ClientSearch purpose="audit" ariaLabel="Pesquisar cliente para consultar o histórico" selected={client} onSelect={setClient}
      canSelect={hasActiveAccount} enabled={active} disabled={disabled} />
    {client && <InformationCard title="Histórico de segurança da conta" headingLevel={3} cardId="client-security-history"
      loading={resource.loading} refreshing={resource.refreshing} error={resource.error} onRetry={resource.refresh}>
      {resource.data && <>
        <p className="field-help">Até às 10 operações de segurança mais recentes da conta, como alterações de acesso e reposições de Passkeys.</p>
        {resource.data.history.length > 0
          ? <ol className={styles.timeline}>{resource.data.history.map(item => <li key={item.id} className={styles.event}>
            <div className={styles.eventHeader}>
              <strong>{actionLabels[item.kind] || item.kind}</strong>
              <time dateTime={item.createdAt}>{agendaDate(item.createdAt)}</time>
            </div>
            <div className={styles.meta}>
              <span className={styles.badge}>{statusLabels[item.status] || item.status}</span>
              <span>{authorLabel(item.createdByAccountId, resource.data.accountId)}</span>
            </div>
          </li>)}</ol>
          : <p>Não existem operações de segurança registadas nesta conta.</p>}
      </>}
    </InformationCard>}
  </section>
}
