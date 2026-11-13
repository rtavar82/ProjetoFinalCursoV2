import Heading from './Heading'
import AgendaPresentation from './AgendaPresentation'
import SectionTabs from './SectionTabs'
import useRecoveryRecord from './useRecoveryRecord'
import useRecoveryState from './useRecoveryState'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import ClientProfileForm from './ClientProfileForm'
import FinancialSalesPanel from './FinancialSalesPanel'
import SessionPacksPanel from './SessionPacksPanel'
import { announceOperation } from './actionNotices'
import ClientReviewCard from './ClientReviewCard'
import AccountAccessSettings from './AccountAccessSettings'
import styles from './Clients.module.css'
import useLiveResource from './useLiveResource'
import InformationCard from './InformationCard'
import ClientSearch from './ClientSearch'
import { clientAccountStateLabel } from './clientLabels'
import Pagination from './Pagination'
import { invalidateResources, observeResource } from './liveUpdates'

function nameOf(client) { return [client.data.firstName, client.data.lastName].filter(Boolean).join(' ') || 'Nome ainda não indicado' }

export default function Clients({ busy, perform, notify, guard, initialView = 'Directory', initialId = null, pendingReviewCount }) {
  const [view, setView] = useRecoveryState('view:' + 'clients' + ':view', initialId ? 'Detail' : initialView)
  const [area, setArea] = useRecoveryState('view:clients:area', 'Data')
  const [editedClient, setClient] = useRecoveryRecord('client', 'clients/', 'clients')
  const dirty = useRef(false)
  const openedId = editedClient?.id
  useEffect(() => {
    if (view !== 'Detail' || !openedId) return
    let current = true
    const stop = observeResource('clients', async () => {
      try { const value = await apiRequest('clients/' + openedId); if (current && !dirty.current) setClient(value) }
      catch { /* The shared read warning reports connection failures; keep the open form. */ }
    })
    return () => { current = false; stop() }
  }, [view, openedId, setClient])
  const readInitial = useCallback(signal => apiRequest('clients/' + initialId, undefined, { signal }), [initialId])
  const initial = useLiveResource('clients', 'client-entry:' + initialId, readInitial, !!initialId && view === 'Detail' && !editedClient)
  const client = editedClient || (view === 'Detail' ? initial.data : null)
  function open(id) { if (view === 'Detail' && client?.id === id) return; guard(() => perform(async () => { const data = await apiRequest('clients/' + id); dirty.current = false; setClient(data); setArea('Data'); setView('Detail') })) }
  function recoveredSave(result) { if (result.saved && result.client) { dirty.current = false; setClient(result.client); setArea('Data'); setView('Detail') } }
  function save(input) { perform(async () => {
    const saved = await apiRequest(client ? 'clients/' + client.id : 'clients', input)
    notify(saved.message, !saved.saved)
    if (saved.saved) { dirty.current = false; setClient(saved.client); setArea('Data'); setView('Detail') }
  }) }
  async function sendPack(command) {
    let result
    await perform(async () => {
      const input = { ...command, operationId: crypto.randomUUID() }
      result = await apiRequest('consultations/commands', input)
      announceOperation(input, result)
    })
    return result
  }
  const canManageAccess = client?.hasAccount && client.accountState === 'Active'
  const currentArea = area === 'Access' && !canManageAccess ? 'Data' : area
  const areas = [{ id: 'Data', label: 'Dados' }, ...(canManageAccess ? [{ id: 'Access', label: 'Acesso e segurança' }] : []), { id: 'Sales', label: 'Vendas' }, { id: 'Packs', label: 'Packs de sessões' }]
  function changeView(next) {
    if (next === 'Directory' && ['Directory', 'Detail'].includes(view)) {
      if (view === 'Detail') guard(() => { dirty.current = false; setView('Directory') })
      return
    }
    if (next !== view) guard(() => { dirty.current = false; if (next === 'Create') setClient(null); setView(next) })
  }
  return <AgendaPresentation title="Clientes" eyebrow="" headingId="clients-title" description="Pesquisa uma ficha para consultar os dados e o acompanhamento do cliente." contentClassName={styles.content} aria-labelledby="clients-title"
    onChangeCapture={event => { if (event.target.closest('form.client-form') && !dirty.current) { dirty.current = true; if (client) setClient(client) } }}>
    <SectionTabs label="Área Clientes" columns={3} variant="tools" compactMobile disabled={busy}
      items={[{ id: 'Directory', label: 'Pesquisar clientes' }, { id: 'Create', label: 'Criar ficha', variant: 'tinted' }, { id: 'Reviews', label: 'Ocorrências para rever', ...(pendingReviewCount > 0 ? { count: pendingReviewCount } : {}) }]}
      value={view === 'Detail' ? 'Directory' : view} onChange={changeView} />
    <div className={styles.page} hidden={!['Directory', 'Detail'].includes(view)}>
      <ClientSearch purpose="directory" presentation="workspace" enabled={['Directory', 'Detail'].includes(view)} disabled={busy}
        activeId={client?.id} detailOpen={view === 'Detail'} onBack={() => changeView('Directory')} onSelect={person => open(person.id)}>
        {view === 'Detail' && !client && <InformationCard variant="plain" loading={initial.loading} error={initial.error} onRetry={initial.refresh} cardId="client-entry" />}
        {view === 'Detail' && client && <div data-card-id="client-editor">
          <header className={styles.clientHeading}><Heading level={2} appearance="card-title">{nameOf(client)}</Heading>
            <p className={styles.badge}>{client.hasAccount ? 'Com conta · ' + clientAccountStateLabel(client.accountState) : 'Ficha de gestão sem conta de acesso'}</p>
          </header>
          <div className={styles.clientAreas}>
            <SectionTabs label="Áreas da ficha" columns={areas.length} variant="tools" compactMobile items={areas} value={currentArea} disabled={busy}
              onChange={next => { if (next !== currentArea) setArea(next) }} />
            <div hidden={currentArea !== 'Data'}><ClientProfileForm key={client.id + ':' + client.version} client={client} busy={busy} onSave={save} onRecoveredSave={recoveredSave} /></div>
            {canManageAccess && <div hidden={currentArea !== 'Access'}><AccountAccessSettings inline key={client.id} client={client} busy={busy} perform={perform} notify={notify} /></div>}
            <div hidden={currentArea !== 'Sales'}><FinancialSalesPanel key={'sales-' + client.id} personId={client.id} presentation="embedded" enabled={currentArea === 'Sales'} disabled={busy} guard={guard} /></div>
            <div hidden={currentArea !== 'Packs'}><SessionPacksPanel key={'packs-' + client.id} personId={client.id} manager presentation="embedded" enabled={currentArea === 'Packs'} send={sendPack} disabled={busy} guard={guard} /></div>
          </div>
        </div>}
      </ClientSearch>
    </div>
    {view === 'Create' && <InformationCard title="Criar ficha de cliente" cardId="client-create"><ClientProfileForm key="new" manual busy={busy} onSave={save} onRecoveredSave={recoveredSave} /></InformationCard>}
    {view === 'Reviews' && <div className={styles.page}><Reviews busy={busy} perform={perform} notify={notify} onChange={() => invalidateResources(['clients'])} /></div>}
  </AgendaPresentation>
}


function Reviews({ busy, perform, notify, onChange }) {
  const [reviews, setReviews] = useState(null)
  const [page, setPage] = useState(1)
  useEffect(() => { let current = true; async function load() { try { const data = await apiRequest('clients/reviews'); if (current) setReviews({ items: data }) } catch (error) { if (current) setReviews(previous => ({ ...previous, error: error.message })) } } const stop = observeResource('clientReviews', load); return () => { current = false; stop() } }, [])
  function decide(review, decision) { perform(async () => {
    const result = await apiRequest('clients/reviews/' + review.id, { version: review.version, ...decision })
    notify(result.message); setReviews({ items: await apiRequest('clients/reviews') }); setPage(1); onChange()
  }) }
  return <section className={styles.reviews}><Heading level={2}>Ocorrências para rever</Heading><p>Compara as fichas e escolhe os dados finais. Nada é alterado antes da confirmação.</p>
    {!reviews && <p role="status">A carregar ocorrências…</p>}{reviews?.error && <p role="alert" className="notice error">{reviews.error}</p>}
    {reviews?.items?.length === 0 && <p>Não existem ocorrências por resolver.</p>}
    {reviews?.items?.slice((page - 1) * 8, page * 8).map(review => <ClientReviewCard key={review.id + ":" + review.version + ":" + review.source?.version + ":" + review.candidates.map(row => row.id + ":" + row.version).join(",")} review={review} busy={busy} onDecide={decision => decide(review, decision)} />)}
    {reviews?.items && <Pagination total={reviews.items.length} page={page} showTotal onChange={setPage} />}
  </section>
}
