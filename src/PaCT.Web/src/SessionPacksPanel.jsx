import AccountRecordDetail from './AccountRecordDetail'
import ActionButton from './ActionButton'
import CalendarInput from './CalendarInput'
import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import useConsultationNames from './useConsultationNames'
import InformationCard from './InformationCard'
import ConsultationDialog from './ConsultationDialog'
import CardGrid from './CardGrid'
import Pagination from './Pagination'
import { agendaDate, agendaMoney, instant } from './agendaTime'

export default function SessionPacksPanel({ manager, send, disabled, guard, feedback, initialId, personId = null, dialogOnly = false, onClose, inline = false, inlineEntry, fixedScope, enabled = true }) {
  const [selectedScope, setScope] = useState(initialId ? 'Unpaid' : 'Available')
  const scope = fixedScope || selectedScope
  const [inlineId, setInlineId] = useState(inlineEntry?.id)
  const [seenEntry, setSeenEntry] = useState(inlineEntry)
  if (seenEntry !== inlineEntry) {
    setSeenEntry(inlineEntry)
    if (inlineEntry?.id) setInlineId(inlineEntry.id)
  } else if (inline && !enabled && inlineId) {
    setInlineId(null)
  }
  const [page, setPage] = useState(1)
  const [openedDetail, setDetail] = useState(null)
  const detailId = inline ? inlineId : openedDetail?.id
  const readDetail = useCallback(signal => apiRequest('consultations/packs/' + detailId, undefined, { signal }), [detailId])
  const latestDetail = useLiveResource('packs', 'pack-detail:' + detailId, readDetail, enabled && !!detailId)
  const detail = detailId ? latestDetail.data || openedDetail : null
  const [error, setError] = useState('')
  useEffect(() => { if (initialId && !inline) { let active = true; apiRequest('consultations/packs/' + initialId).then(value => { if (active) setDetail(value) }).catch(failure => { if (active) setError(failure.message) }); return () => { active = false } } }, [initialId, inline])
  const read = useCallback(signal => apiRequest(`consultations/packs?scope=${scope}&page=${page}${personId ? '&personId=' + personId : ''}`, undefined, { signal }), [scope, page, personId])
  const list = useLiveResource('packs', `${scope}:${page}:${personId || ''}`, read, enabled && !dialogOnly)
  const names = useConsultationNames(list.data?.items || [], detail, manager)
  async function open(id) { if (inline) { setInlineId(id); return } try { setDetail(await apiRequest('consultations/packs/' + id)); setError('') } catch (failure) { setError(failure.message) } }
  async function act(action, values = {}) { const result = await send({ action, id: detail.id, version: detail.version, ...values }); if (result) await open(detail.id) }
  function dismiss() {
    if (inline) {
      setInlineId(null)
      requestAnimationFrame(() => document.getElementById('account-pack-' + detailId)?.focus())
      return
    }
    setDetail(null)
    onClose?.()
  }
  const Detail = inline ? AccountRecordDetail : ConsultationDialog
  const detailProps = inline
    ? { back: 'Voltar aos packs', onBack: () => guard(dismiss), loading: latestDetail.loading, error: latestDetail.error, onRetry: latestDetail.refresh }
    : { label: 'Detalhe do pack', onClose: () => guard(dismiss) }
  return <section aria-label="Packs de sessões">
    {!dialogOnly && <div hidden={inline && !!detailId}>
    {!detail && feedback}
    {!fixedScope && <nav className="section-tabs" aria-label="Packs"><button className={scope === 'Available' ? '' : 'secondary'} disabled={disabled} onClick={() => guard(() => { setScope('Available'); setPage(1) })}>Packs com sessões</button><button className={scope === 'Unpaid' ? '' : 'secondary'} disabled={disabled} onClick={() => guard(() => { setScope('Unpaid'); setPage(1) })}>Compras por pagar</button>{manager && <button className={scope === 'History' ? '' : 'secondary'} disabled={disabled} onClick={() => guard(() => { setScope('History'); setPage(1) })}>Histórico</button>}</nav>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <InformationCard variant={inline ? 'plain' : 'default'} cardId="session-packs" loading={list.loading} error={list.error} onRetry={list.refresh}>
      <CardGrid>{list.data?.items.map(pack => <InformationCard as="article" cardId={'pack-' + pack.id} key={pack.id} title={pack.title}>{manager && <p>{names.data?.[pack.personId]}</p>}<p>{pack.remaining} de {pack.sessions} sessões</p><p>Referência de um ano: {agendaDate(new Date(Date.parse(pack.expiresAt) - 1).toISOString())}</p><p>{pack.paid ? 'Compra paga' : 'Compra por pagar'} · {agendaMoney(pack.amount)}</p><ActionButton variant="secondary" id={inline ? 'account-pack-' + pack.id : undefined} disabled={disabled} onClick={() => open(pack.id)}>{inline ? 'Ver detalhe' : 'Abrir pack'}</ActionButton></InformationCard>)}</CardGrid>
      {list.data?.total === 0 && <p>Não existem packs neste separador.</p>}<Pagination total={list.data?.total} page={page} pageSize={list.data?.pageSize} label="Páginas dos packs" disabled={disabled} onChange={setPage} />
    </InformationCard>
    </div>}
    {dialogOnly && !detail && <ConsultationDialog title="Pack de sessões" label="Detalhe do pack" disabled={disabled} onClose={() => guard(dismiss)}><InformationCard cardId="pack-detail-loading" loading={!error} error={error} /></ConsultationDialog>}
    {(inline ? enabled && detailId : detail) && <Detail key={detailId} title={detail?.title || 'Pack de sessões'} disabled={disabled} {...detailProps}>{detail && <>{feedback}<p>{detail.remaining} de {detail.sessions} sessões</p><p>Compra de {agendaDate(detail.purchasedAt)} · {agendaMoney(detail.amount)}</p><p>Referência de um ano: {agendaDate(new Date(Date.parse(detail.expiresAt) - 1).toISOString())}</p><p>{detail.paid ? 'Compra paga' : 'Compra por pagar'}</p>
      {manager && !detail.paid && <><p>Crédito disponível: {agendaMoney(detail.balance)}</p><button disabled={disabled || detail.balance < detail.amount} onClick={() => { if (window.confirm(`Confirmas o pagamento integral de ${agendaMoney(detail.amount)} com crédito?`)) act('SettlePack') }}>Pagar integralmente com crédito</button></>}
      {manager && <>
        <p>As sessões não são bloqueadas automaticamente pela data de revisão.</p>
        <form data-protect-draft onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); act('SetPackValidity', { reason: values.get('reason'), validUntil: values.get('date') ? instant(values.get('date')) : null }) }}><label>Data de revisão interna (opcional)<CalendarInput name="date" type="datetime-local" defaultValue={detail.validUntil ? new Date(detail.validUntil).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T') : ''} /></label><label>Motivo<textarea name="reason" required maxLength="2000" /></label><button disabled={disabled}>Guardar data de revisão</button></form>
        {detail.remaining > 0 && <form data-protect-draft onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); if (window.confirm('Confirmas a retirada destas sessões, com registo no histórico?')) act('WithdrawPackSessions', { reason: values.get('reason'), quantity: Number(values.get('quantity')) }) }}><label>Sessões a retirar<input name="quantity" type="number" min="1" max={detail.remaining} required /></label><label>Motivo<textarea name="reason" required maxLength="2000" /></label><button className="secondary" disabled={disabled}>Retirar sessões</button></form>}
        {detail.history?.map((h, i) => <p key={i}>{agendaDate(h.at)} · {h.action === 'WithdrawPackSessions' ? `Retirada de ${h.quantity} sessões` : h.action === 'SetPackValidity' ? 'Data de revisão alterada' : h.action} · {h.reason}</p>)}
      </>}
      {!manager && detail.decisions?.map((h, i) => <p key={i}>{agendaDate(h.at)} · {h.action === 'WithdrawPackSessions' ? `Retirada de ${h.quantity} sessões por decisão da gestão` : h.action === 'SetPackValidity' ? 'Data de revisão atualizada' : 'Acordo atualizado'}</p>)}
      <h3>Utilização das sessões</h3>{detail.uses.length === 0 && <p>Ainda não foram utilizadas sessões.</p>}{detail.uses.map(use => <article key={use.id}><p>{agendaDate(use.activityAt)} · {use.reversesId ? 'Sessão reposta' : use.reversed ? 'Consumo reposto' : 'Sessão utilizada'}</p>{manager && !use.reversesId && !use.reversed && <form data-protect-draft onSubmit={event => { event.preventDefault(); if (window.confirm('Confirmas a reposição desta sessão?')) act('ReversePackUse', { packUseId: use.id, reason: new FormData(event.currentTarget).get('reason') }) }}><label>Motivo da reposição<input name="reason" required maxLength="2000" /></label><button className="secondary" disabled={disabled}>Repor sessão com registo de correção</button></form>}</article>)}
    </>}</Detail>}
  </section>
}
