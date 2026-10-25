import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import useClientOptions from './useClientOptions'
import InformationCard from './InformationCard'
import ConsultationDialog from './ConsultationDialog'
import { agendaDate } from './agendaTime'
import styles from './GuestRequests.module.css'

const states = { Requested: 'Por analisar', InTreatment: 'Em tratamento', Linked: 'Ficha associada', Rejected: 'Recusado', Expired: 'Expirado' }
export default function GuestRequests({ send, disabled, guard, onCreateClient, feedback, initialId }) {
  const [page, setPage] = useState(1)
  const [history, setHistory] = useState(false)
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!initialId) return
    let active = true
    apiRequest('consultations/guests/' + initialId).then(value => { if (active) setDetail(value) }).catch(failure => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [initialId])
  const read = useCallback(signal => apiRequest(`consultations/guests?page=${page}&history=${history}`, undefined, { signal }), [page, history])
  const list = useLiveResource('guestRequests', `${page}:${history}`, read)
  const clients = useClientOptions(!!detail && !['Linked', 'Rejected', 'Expired'].includes(detail.state))
  async function decide(action, values = {}) {
    const result = await send({ action, id: detail.id, version: detail.version, ...values })
    if (result) setDetail(null)
  }
  async function open(id) { try { setDetail(await apiRequest('consultations/guests/' + id)); setError('') } catch (failure) { setError(failure.message) } }
  return <section className={styles.page} aria-label="Pedidos sem conta">
    {!detail && feedback}
    <nav className="section-tabs"><button className={!history ? '' : 'secondary'} disabled={disabled} onClick={() => { setPage(1); setHistory(false) }}>Por analisar</button><button className={history ? '' : 'secondary'} disabled={disabled} onClick={() => { setPage(1); setHistory(true) }}>Histórico</button></nav>
    {error && <p role="alert" className="notice error">{error}</p>}
    <InformationCard title="Pedidos sem conta" cardId="guest-requests" loading={list.loading} error={list.error} onRetry={list.refresh}>
      {list.data?.items.map(request => <article className={styles.request} key={request.id}><div><h3>{request.contact.firstName} {request.contact.lastName}</h3><p>{request.serviceTitle} · {agendaDate(request.startsAt)}</p><p>{states[request.state]}</p></div><button className="secondary" disabled={disabled} onClick={() => open(request.id)}>Analisar pedido</button></article>)}
      {list.data?.total === 0 && <p>Não existem pedidos neste separador.</p>}
      {list.data?.total > 8 && <nav className="pager" aria-label="Páginas dos pedidos"><button disabled={disabled || page === 1} onClick={() => setPage(p => p - 1)}>Anterior</button><span>Página {page}</span><button disabled={disabled || page * 8 >= list.data.total} onClick={() => setPage(p => p + 1)}>Seguinte</button></nav>}
    </InformationCard>
    {detail && <ConsultationDialog label="Pedido de consulta" disabled={disabled} onClose={() => guard(() => setDetail(null))}>
      {feedback}
      <h2>{detail.contact.firstName} {detail.contact.lastName}</h2><p>{detail.serviceTitle} · {agendaDate(detail.startsAt)}</p><p>{states[detail.state]}</p>
      <p>+{detail.contact.dialCode} {detail.contact.phone}</p>{detail.contact.email && <p>{detail.contact.email}</p>}
      {['Requested', 'InTreatment'].includes(detail.state) && <>
        {detail.state === 'Requested' && <button disabled={disabled} onClick={() => decide('StartGuestTreatment')}>Marcar em tratamento</button>}
        {clients.error && <p role="alert">{clients.error}</p>}
        <form data-protect-draft onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); decide('LinkGuestRequest', { personId: values.get('personId'), conditionsAccepted: values.has('verified') }) }}>
          <label>Ficha do cliente<select name="personId" required defaultValue={detail.personId || ''} disabled={disabled || clients.loading}><option value="">Seleciona a ficha verificada</option>{(clients.data || []).filter(p => p.isActive !== false && p.identityReviewStatus !== 'Pending').map(p => <option key={p.id} value={p.id}>{p.data.firstName} {p.data.lastName}</option>)}</select></label>
          <label className="checkbox"><input name="verified" type="checkbox" required disabled={disabled} />Verifiquei a identidade e confirmo a ficha selecionada.</label>
          <button disabled={disabled || clients.loading}>Aprovar pedido e confirmar marcação</button>
        </form>
        {onCreateClient && <button type="button" className="secondary" disabled={disabled} onClick={() => guard(onCreateClient)}>Criar ficha em Clientes</button>}
        <button type="button" className="secondary" disabled={disabled} onClick={() => { if (window.confirm('Confirmas a recusa deste pedido?')) decide('RejectGuestRequest') }}>Recusar pedido</button>
      </>}
      {detail.history.length > 0 && <details><summary>Histórico do pedido</summary>{detail.history.map((entry, index) => <p key={`${entry.at}:${index}`}>{agendaDate(entry.at)} · {({ StartGuestTreatment: 'Em tratamento', LinkGuestRequest: 'Ficha associada', RejectGuestRequest: 'Recusado' })[entry.action]}</p>)}</details>}
    </ConsultationDialog>}
  </section>
}
