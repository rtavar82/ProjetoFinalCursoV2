import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import useClientOptions from './useClientOptions'
import useConsultationNames from './useConsultationNames'
import InformationCard from './InformationCard'
import ConsultationDialog from './ConsultationDialog'
import CardGrid from './CardGrid'
import { agendaDate, agendaMoney, instant } from './agendaTime'

export default function SessionPacksPanel({ manager, send, disabled, guard, feedback, initialId }) {
  const [scope, setScope] = useState(initialId ? 'Unpaid' : 'Available')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { if (initialId) { let active = true; apiRequest('consultations/packs/' + initialId).then(value => { if (active) setDetail(value) }).catch(failure => { if (active) setError(failure.message) }); return () => { active = false } } }, [initialId])
  const read = useCallback(signal => apiRequest(`consultations/packs?scope=${scope}&page=${page}`, undefined, { signal }), [scope, page])
  const list = useLiveResource('packs', `${scope}:${page}`, read)
  const names = useConsultationNames(list.data?.items || [], detail, manager)
  const clients = useClientOptions(manager && creating)
  const readSetup = useCallback(signal => apiRequest('consultations/setup', undefined, { signal }), [])
  const setup = useLiveResource('agenda', 'pack-services', readSetup, manager && creating)
  async function open(id) { try { setDetail(await apiRequest('consultations/packs/' + id)); setError('') } catch (failure) { setError(failure.message) } }
  async function act(action, values = {}) { const result = await send({ action, id: detail.id, version: detail.version, ...values }); if (result) await open(detail.id) }
  return <section aria-label="Packs de sessões">
    {!detail && feedback}
    <nav className="section-tabs" aria-label="Packs"><button className={scope === 'Available' ? '' : 'secondary'} disabled={disabled} onClick={() => guard(() => { setScope('Available'); setPage(1); setCreating(false) })}>Packs com sessões</button><button className={scope === 'Unpaid' ? '' : 'secondary'} disabled={disabled} onClick={() => guard(() => { setScope('Unpaid'); setPage(1); setCreating(false) })}>Compras por pagar</button>{manager && <><button className={scope === 'History' ? '' : 'secondary'} disabled={disabled} onClick={() => guard(() => { setScope('History'); setPage(1); setCreating(false) })}>Histórico</button><button className="secondary" disabled={disabled} onClick={() => guard(() => setCreating(true))}>Registar compra</button></>}</nav>
    {error && <p className="notice error" role="alert">{error}</p>}
    {creating && manager && <InformationCard title="Registar compra de pack" cardId="pack-purchase" loading={clients.loading || setup.loading} error={clients.error || setup.error}>
      <form data-protect-draft onSubmit={async event => { event.preventDefault(); const fields = new FormData(event.currentTarget); try {
        const result = await send({ action: 'PurchasePack', packPurchase: { personId: fields.get('personId'), title: fields.get('title'), sessions: Number(fields.get('sessions')), amount: Number(fields.get('amount')), purchasedAt: instant(fields.get('purchasedAt')), serviceIds: fields.getAll('serviceId'), regularTotal: Number(fields.get('regularTotal')), validUntil: fields.get('validUntil') ? instant(fields.get('validUntil')) : null } }); if (result) setCreating(false)
      } catch (failure) { setError(failure.message) } }}>
        <fieldset disabled={disabled}><label>Cliente<select name="personId" required defaultValue=""><option value="">Seleciona a ficha</option>{(clients.data || []).filter(p => p.identityReviewStatus !== 'Pending').map(p => <option value={p.id} key={p.id}>{p.data.firstName} {p.data.lastName}</option>)}</select></label>
          <label>Nome do pack<input name="title" maxLength="200" required /></label><label>Sessões<input name="sessions" type="number" min="1" max="1000" required /></label><label>Valor total acordado<input name="amount" type="number" min="0.01" max="1000000" step="0.01" required /></label><label>Valor das mesmas sessões avulso<input name="regularTotal" type="number" min="0.01" max="1000000" step="0.01" required /></label><label>Data de revisão interna (opcional)<input name="validUntil" type="datetime-local" /></label><p>A compra utiliza o valor total do saldo monetário. O recebimento deve estar confirmado antes de comprar o pack.</p><label>Data da compra (Lisboa)<input name="purchasedAt" type="datetime-local" required /></label>
          <fieldset><legend>Serviços compatíveis</legend>{setup.data?.services.filter(s => s.active).map(s => <label className="checkbox" key={s.id}><input type="checkbox" name="serviceId" value={s.id} disabled={s.serviceKind === 'Retreat' || s.paymentMode === 'Free'} />{s.title}{s.serviceKind === 'Retreat' || s.paymentMode === 'Free' ? ' — não abrangido por packs' : ''}</label>)}</fieldset><button>Guardar compra</button>
        </fieldset>
      </form>
    </InformationCard>}
    <InformationCard cardId="session-packs" loading={list.loading} error={list.error} onRetry={list.refresh}>
      <CardGrid>{list.data?.items.map(pack => <InformationCard as="article" cardId={'pack-' + pack.id} key={pack.id} title={pack.title}><p>{manager && names.data?.[pack.personId]}</p><p>{pack.remaining} de {pack.sessions} sessões</p><p>Referência de um ano: {agendaDate(new Date(Date.parse(pack.expiresAt) - 1).toISOString())}</p><p>{pack.settlementId ? 'Compra paga' : 'Compra por pagar'} · {agendaMoney(pack.amount)}</p><button className="secondary" disabled={disabled} onClick={() => open(pack.id)}>Abrir pack</button></InformationCard>)}</CardGrid>
      {list.data?.total === 0 && <p>Não existem packs neste separador.</p>}{list.data?.total > 8 && <nav className="pager" aria-label="Páginas dos packs"><button disabled={disabled || page === 1} onClick={() => setPage(p => p - 1)}>Anterior</button><span>Página {page}</span><button disabled={disabled || page * 8 >= list.data.total} onClick={() => setPage(p => p + 1)}>Seguinte</button></nav>}
    </InformationCard>
    {detail && <ConsultationDialog label="Detalhe do pack" disabled={disabled} onClose={() => guard(() => setDetail(null))}><h2>{detail.title}</h2>{feedback}<p>{detail.remaining} de {detail.sessions} sessões</p><p>Compra de {agendaDate(detail.purchasedAt)} · {agendaMoney(detail.amount)}</p><p>Referência de um ano: {agendaDate(new Date(Date.parse(detail.expiresAt) - 1).toISOString())}</p><p>{detail.settlementId ? 'Compra paga' : 'Compra por pagar'}</p>
      {manager && !detail.settlementId && <><p>Crédito disponível: {agendaMoney(detail.balance)}</p><button disabled={disabled || detail.balance < detail.amount} onClick={() => { if (window.confirm(`Confirmas o pagamento integral de ${agendaMoney(detail.amount)} com crédito?`)) act('SettlePack') }}>Pagar integralmente com crédito</button></>}
      {manager && <>
        <p>As sessões não são bloqueadas automaticamente pela data de revisão.</p>
        <form data-protect-draft onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); act('SetPackValidity', { reason: values.get('reason'), validUntil: values.get('date') ? instant(values.get('date')) : null }) }}><label>Data de revisão interna (opcional)<input name="date" type="datetime-local" defaultValue={detail.validUntil ? new Date(detail.validUntil).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T') : ''} /></label><label>Motivo<textarea name="reason" required maxLength="2000" /></label><button disabled={disabled}>Guardar data de revisão</button></form>
        {detail.remaining > 0 && <form data-protect-draft onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); if (window.confirm('Confirmas a retirada destas sessões, com registo no histórico?')) act('WithdrawPackSessions', { reason: values.get('reason'), quantity: Number(values.get('quantity')) }) }}><label>Sessões a retirar<input name="quantity" type="number" min="1" max={detail.remaining} required /></label><label>Motivo<textarea name="reason" required maxLength="2000" /></label><button className="secondary" disabled={disabled}>Retirar sessões</button></form>}
        {detail.history?.map((h, i) => <p key={i}>{agendaDate(h.at)} · {h.action === 'WithdrawPackSessions' ? `Retirada de ${h.quantity} sessões` : h.action === 'SetPackValidity' ? 'Data de revisão alterada' : h.action} · {h.reason}</p>)}
      </>}
      {!manager && detail.decisions?.map((h, i) => <p key={i}>{agendaDate(h.at)} · {h.action === 'WithdrawPackSessions' ? `Retirada de ${h.quantity} sessões por decisão da gestão` : h.action === 'SetPackValidity' ? 'Data de revisão atualizada' : 'Acordo atualizado'}</p>)}
      <h3>Utilização das sessões</h3>{detail.uses.length === 0 && <p>Ainda não foram utilizadas sessões.</p>}{detail.uses.map(use => <article key={use.id}><p>{agendaDate(use.activityAt)} · {use.reversesId ? 'Sessão reposta' : use.reversed ? 'Consumo reposto' : 'Sessão utilizada'}</p>{manager && !use.reversesId && !use.reversed && <form data-protect-draft onSubmit={event => { event.preventDefault(); if (window.confirm('Confirmas a reposição desta sessão?')) act('ReversePackUse', { packUseId: use.id, reason: new FormData(event.currentTarget).get('reason') }) }}><label>Motivo da reposição<input name="reason" required maxLength="2000" /></label><button className="secondary" disabled={disabled}>Repor sessão com registo de correção</button></form>}</article>)}
    </ConsultationDialog>}
  </section>
}
