import AdaptiveSelect from './AdaptiveSelect'
import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import useClientOptions from './useClientOptions'
import useConsultationNames from './useConsultationNames'
import InformationCard from './InformationCard'
import CardGrid from './CardGrid'
import ConsultationDialog from './ConsultationDialog'
import ConsultationConditionsForm from './ConsultationConditionsForm'
import { FinancialEntryForm } from './FinancePanel'
import CreditSettlementForm from './CreditSettlementForm'
import EventAttendanceForm from './EventAttendanceForm'
import { RetreatDefinition, RetreatPayments } from './RetreatForms'
import { agendaDate, agendaMoney, instant, localDate } from './agendaTime'
import styles from './GroupEventsPanel.module.css'


export default function GroupEventsPanel({ manager = false, visitor = false, send, disabled = false, guard = action => action(), feedback, onGuest, initialEntry }) {
  const [page, setPage] = useState(1)
  const [history, setHistory] = useState(false)
  const [openedDetail, setDetail] = useState(null)
  const detailId = openedDetail?.summary.id
  const readDetail = useCallback(() => apiRequest('consultations/events/' + detailId), [detailId])
  const latestDetail = useLiveResource('events', 'event-detail:' + detailId, readDetail, !!detailId)
  const detail = detailId ? latestDetail.data || openedDetail : null
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const serviceId = initialEntry?.serviceId || ''
  const read = useCallback(signal => apiRequest(`consultations/events?page=${page}&history=${history}${serviceId ? '&serviceId=' + encodeURIComponent(serviceId) : ''}`, undefined, { signal }), [page, history, serviceId])
  const list = useLiveResource('events', `${page}:${history}:${serviceId}`, read)
  const readSetup = useCallback(signal => apiRequest('consultations/setup', undefined, { signal }), [])
  const setup = useLiveResource('agenda', 'event-services', readSetup, manager && !!editing)
  const people = useClientOptions(manager && (!!editing || !!detail))
  const open = useCallback(async id => { try { setDetail(await apiRequest('consultations/events/' + id)); setError('') } catch (failure) { setError(failure.message) } }, [])
  const initialEventId = initialEntry?.events ? initialEntry.id : null
  const initialRevision = initialEntry?.revision
  useEffect(() => { if (initialEventId) { let active = true; apiRequest('consultations/events/' + initialEventId).then(value => { if (active) setDetail(value) }).catch(failure => { if (active) setError(failure.message) }); return () => { active = false } } }, [initialEventId, initialRevision])
  async function command(input, retry = false, cleanup = null) {
    const result = await send(input, retry, cleanup)
    if (result && detail) await open(detail.summary.id)
    return result
  }
  return <section className={styles.page} aria-label="Grupos e retiros">
    {!detail && feedback}
    <div className={styles.heading}><h2>Grupos e retiros</h2>{manager && <nav className="section-tabs"><button className="secondary" disabled={disabled} onClick={() => guard(() => setEditing({}))}>Criar evento</button><button className="secondary" disabled={disabled} onClick={() => { setHistory(value => !value); setPage(1) }}>{history ? 'Próximos eventos' : 'Ver histórico'}</button></nav>}</div>
    {error && <p role="alert" className="notice error">{error}</p>}
    {editing && manager && <EventEditor key={editing.id || 'new'} event={editing} setup={setup} people={people} disabled={disabled} send={async input => { const result = await command(input); if (result) setEditing(null); return result }} onBack={() => guard(() => setEditing(null))} />}
    <InformationCard cardId="group-events" loading={list.loading} error={list.error} onRetry={list.refresh}>
      <CardGrid>{list.data?.items.map(item => <InformationCard as="article" title={item.title} cardId={'event-' + item.id} key={item.id}>
        <p>{item.kind === 'Retreat' ? 'Retiro' : 'Grupo'} · {item.process.processLabel}</p><p>{agendaDate(item.startsAt)} — {agendaDate(item.endsAt)}</p><p>{item.publicLocation}</p>
        <p>{item.isFree ? 'Participação gratuita' : item.paymentMode === 'Contribution' ? 'Contribuição livre' : item.referencePrice === null ? 'Valor a combinar' : agendaMoney(item.totalPrice ?? item.referencePrice)}</p>
        <p>{item.state !== 'Scheduled' ? 'Inscrições encerradas' : item.remaining > 0 ? `${item.remaining} vagas disponíveis` : 'Inscrições completas'}</p>
        {item.program && <div className={styles.note}><h3>Programa</h3>{item.program}</div>}{item.cancellationConditions && <div className={styles.note}><h3>Cancelamento</h3>{item.cancellationConditions}</div>}{item.kind === 'Retreat' && <p>Pagamento integral.</p>}
        {item.restricted && <p>Inscrição sujeita a autorização.</p>}
        {visitor ? item.state === 'Scheduled' && <button className="secondary" disabled={item.remaining === 0 || item.restricted} onClick={() => onGuest?.({ eventId: item.id, serviceId: item.serviceId, startsAt: item.startsAt, service: { id: item.serviceId, title: item.title, referencePrice: item.totalPrice ?? item.referencePrice, paymentMode: item.paymentMode } })}>Pedir inscrição</button>
          : <button className="secondary" disabled={disabled} onClick={() => open(item.id)}>{manager ? 'Gerir evento' : item.hasParticipation ? 'Ver a minha inscrição' : 'Ver evento'}</button>}
      </InformationCard>)}</CardGrid>{list.data?.total === 0 && <p>Não existem eventos neste período.</p>}
      {list.data?.total > 8 && <nav className="pager" aria-label="Páginas dos eventos"><button disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</button><span>Página {page}</span><button disabled={page * 8 >= list.data.total} onClick={() => setPage(p => p + 1)}>Seguinte</button></nav>}
    </InformationCard>
    {detail && <ConsultationDialog label="Detalhe do evento" disabled={disabled} onClose={() => guard(() => setDetail(null))}><h2>{detail.summary.title}</h2>{feedback}<p>{agendaDate(detail.summary.startsAt)} — {agendaDate(detail.summary.endsAt)}</p><p>{detail.summary.publicLocation} · {detail.summary.process.processLabel}</p>{detail.instructions && <p className={styles.note}>{detail.instructions}</p>}
      {!manager && <>{!detail.summary.hasParticipation && detail.summary.state === 'Scheduled' && detail.summary.eligible && (detail.summary.kind === 'Group' && !detail.summary.isFree
        ? <section aria-label="Inscrição na consulta de grupo"><h3>Inscrição na consulta de grupo</h3><p>{detail.paymentConditions?.label}</p><p>{detail.summary.referencePrice === null ? 'Contribuição livre' : agendaMoney(detail.summary.referencePrice)}</p>
          <ConsultationConditionsForm consultation={{ paymentConditions: detail.paymentConditions, balance: detail.balance, referencePrice: detail.summary.referencePrice }} disabled={disabled || detail.summary.remaining === 0}
            submitLabel={detail.paymentConditions?.mode === 'Prepayment' ? 'Confirmar inscrição. De seguida farei este pagamento.' : 'Aceitar condições e confirmar inscrição'}
            onAccept={fields => command({ action: 'JoinEvent', id: detail.summary.id, version: detail.summary.version, ...fields })} /></section>
        : <button disabled={disabled || detail.summary.remaining === 0} onClick={() => command({ action: 'JoinEvent', id: detail.summary.id, version: detail.summary.version })}>Confirmar inscrição</button>)}{detail.ownParticipations.map(p => <Participation key={p.id} participation={p} event={detail} disabled={disabled} send={command} />)}</>}
      {manager && <>
        {detail.summary.state === 'Scheduled' && <>
          <button className="secondary" disabled={disabled} onClick={() => guard(() => { setEditing({ id: detail.summary.id, version: detail.summary.version, definition: detail.definition }); setDetail(null) })}>Editar evento</button>
          <form data-protect-draft onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); command({ action: 'CancelEvent', id: detail.summary.id, version: detail.summary.version, availabilityChoice: fields.get('availability') }) }}><label>Horário após cancelamento<AdaptiveSelect name="availability" required defaultValue=""><option value="">Escolhe o destino do horário</option><option value="Release">Libertar</option><option value="Keep">Manter bloqueado</option></AdaptiveSelect></label><button className="secondary" disabled={disabled}>Cancelar evento</button></form>
          <form data-protect-draft onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); try { command({ action: 'PerformEvent', id: detail.summary.id, version: detail.summary.version, startsAt: instant(fields.get('start')), endsAt: instant(fields.get('end')) }) } catch (failure) { setError(failure.message) } }}><h3>Registar realização</h3><label>Início efetivo (Lisboa)<input name="start" type="datetime-local" required /></label><label>Fim efetivo (Lisboa)<input name="end" type="datetime-local" required /></label><button disabled={disabled}>Confirmar realização</button></form>
        </>}
        {detail.keepBlocked && <button className="secondary" disabled={disabled} onClick={() => command({ action: 'ReleaseEventBlock', id: detail.summary.id, version: detail.summary.version })}>Libertar horário cancelado</button>}
        {detail.summary.state !== 'Cancelled' && <AddParticipant event={detail} people={people} disabled={disabled} send={command} />}
        <EventRoster event={detail} disabled={disabled} send={command} people={people} guard={guard} initialParticipationId={initialEntry?.participationId} />
      </>}
    </ConsultationDialog>}
  </section>
}

function AddParticipant({ event, people, disabled, send }) {
  const free = event.summary.isFree === true
  const [choice, setChoice] = useState('Confirmed')
  const [method, setMethod] = useState('NoCharge')
  const [error, setError] = useState('')
  return <form data-protect-draft onSubmit={e => {
    e.preventDefault(); const fields = new FormData(e.currentTarget); setError('')
    try { send({ action: 'JoinEvent', id: event.summary.id, version: event.summary.version,
      personId: choice === 'Anonymous' ? undefined : fields.get('personId'), choice, conditionsAccepted: fields.has('overcapacity'),
      ...(choice === 'Anonymous' ? { method: free ? 'NoCharge' : method, amount: !free && fields.get('amount') ? Number(fields.get('amount')) : null, method2: fields.get('cashMethod'), ...(!free && method === 'AnonymousPaid' ? { startsAt: instant(fields.get('receivedAt')) } : {}) } : {}),
    }) } catch (failure) { setError(failure.message) }
  }}><h3>Adicionar participante</h3>{error && <p role="alert">{error}</p>}<fieldset disabled={disabled}>
    <label>Inscrição<AdaptiveSelect name="choice" value={choice} onChange={e => setChoice(e.target.value)}><option value="Confirmed">Confirmada</option>{event.summary.state !== 'Performed' && <option value="Waiting">Em espera</option>}{event.summary.state === 'Performed' && <option value="Anonymous">Anónima, sem dívida pessoal</option>}</AdaptiveSelect></label>
    {choice !== 'Anonymous' ? <label>Cliente<AdaptiveSelect name="personId" defaultValue="" required><option value="">Seleciona a ficha</option>{people.data?.filter(p => p.identityReviewStatus !== 'Pending').map(p => <option key={p.id} value={p.id}>{p.data.firstName} {p.data.lastName}</option>)}</AdaptiveSelect></label> : <>
      {free ? <p>Participação gratuita.</p> : <label>Tratamento financeiro<AdaptiveSelect value={method} onChange={e => setMethod(e.target.value)}><option value="NoCharge">Sem cobrança</option><option value="AnonymousPaid">Pagamento integral já recebido</option></AdaptiveSelect></label>}
      {!free && method === 'AnonymousPaid' && <><label>Valor recebido<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Meio de recebimento<AdaptiveSelect name="cashMethod"><option value="Cash">Dinheiro</option><option value="Transfer">Transferência</option><option value="MbWay">MB WAY</option><option value="Card">Cartão</option><option value="Other">Outro</option></AdaptiveSelect></label><label>Data de recebimento (Lisboa)<input name="receivedAt" type="datetime-local" required /></label></>}
    </>}
    <button>Adicionar participante</button>
  </fieldset></form>
}

export function EventEditor({ event, setup, people, disabled, send, onBack, fixedService = false }) {
  const [error, setError] = useState('')
  const [restrict, setRestrict] = useState(!!event.definition?.allowedPersonIds?.length)
  const [overrideId, setOverrideId] = useState('')
  const [selectedService, setSelectedService] = useState(event.definition?.serviceId || '')
  const service = setup.data?.services.find(s => s.id === selectedService)
  const retreat = service?.serviceKind === 'Retreat'
  const paidOccurrence = service?.definedPerEvent && !['Free', 'Contribution'].includes(service.paymentMode)
  const block = setup.data?.windows.find(w => w.id === overrideId)
  return <InformationCard title={event.id ? 'Editar evento' : 'Criar grupo ou retiro'} cardId="event-editor" loading={setup.loading || people.loading} error={setup.error || people.error}>
    {error && <p role="alert" className="notice error">{error}</p>}
    <form data-protect-draft onSubmit={async e => { e.preventDefault(); const fields = new FormData(e.currentTarget); try {
      if (restrict && !fields.getAll('person').length) throw new Error('Seleciona pelo menos uma ficha autorizada.')
      await send({ action: 'SaveEvent', id: event.id, version: event.version || 0, event: { serviceId: selectedService, startsAt: instant(fields.get('start')), endsAt: instant(fields.get('end')), publicLocation: fields.get('location'), capacity: Number(fields.get('capacity')), published: fields.has('published'), billingMode: !retreat && service?.paymentMode !== 'Free' ? fields.get('billingMode') || service?.paymentMode : null, promoted: fields.has('promoted'), promotionText: fields.get('promotionText'), allowedPersonIds: restrict ? fields.getAll('person') : null, ...(!retreat && paidOccurrence ? { totalPrice: Number(fields.get('totalPrice')) } : {}), ...(retreat ? { program: fields.get('program'), totalPrice: Number(fields.get('totalPrice')), cancellationConditions: fields.get('cancellation') } : {}) }, conditionsAccepted: fields.has('promoted'), ...(fields.has('override') && block ? { overrideWindowId: block.id, overrideWindowVersion: block.version } : {}) })
    } catch (failure) { setError(failure.message) } }}><fieldset className={styles.eventFields} disabled={disabled}>
      {!fixedService && <label>Tipo de grupo ou retiro<AdaptiveSelect aria-label="Tipo de grupo ou retiro" name="service" required value={selectedService} onChange={e => setSelectedService(e.target.value)}><option value="">Escolhe grupo ou retiro</option>{setup.data?.services.filter(s => s.serviceKind === 'Group' || s.serviceKind === 'Retreat').map(s => <option value={s.id} key={s.id}>{s.title}</option>)}</AdaptiveSelect></label>}<label>Início (Lisboa)<input type="datetime-local" name="start" required defaultValue={event.definition?.startsAt ? localDate(new Date(event.definition.startsAt)) : ''} /></label><label>Fim (Lisboa)<input type="datetime-local" name="end" required defaultValue={event.definition?.endsAt ? localDate(new Date(event.definition.endsAt)) : ''} /></label><label>Local público<input name="location" required maxLength="300" defaultValue={event.definition?.publicLocation || ''} /></label><label>Lotação<input name="capacity" type="number" min="1" max="10000" required defaultValue={event.definition?.capacity || ''} /></label>
      {!retreat && paidOccurrence && <label>Preço por participante<input aria-label="Preço por participante" name="totalPrice" type="number" min="0.01" step="0.01" required defaultValue={event.definition?.totalPrice ?? ''} /></label>}
      {!retreat && service && !['Free', 'Contribution'].includes(service.paymentMode) && <label>Pagamento da consulta de grupo<AdaptiveSelect name="billingMode" defaultValue={event.definition?.billingMode || service.paymentMode}><option value="Prepayment">Antes da consulta</option><option value="Postpayment">Depois da consulta</option></AdaptiveSelect></label>}
      {service?.paymentMode === 'Free' && <p>Participação gratuita, sem contribuição.</p>}
      {retreat && <RetreatDefinition definition={event.definition} disabled={disabled} />}
      <label className="checkbox"><input type="checkbox" name="promoted" />Divulgar também em Partilhas</label><label>Texto de divulgação (opcional)<textarea name="promotionText" maxLength="2000" defaultValue={event.definition?.promotionText || ''} /></label>
      <label className="checkbox"><input type="checkbox" name="published" defaultChecked={event.definition?.published ?? true} />Publicado na agenda</label><label className="checkbox"><input type="checkbox" checked={restrict} onChange={e => setRestrict(e.target.checked)} />Limitar a fichas autorizadas</label>
      {restrict && <fieldset><legend>Fichas autorizadas</legend>{people.data?.map(p => <label className="checkbox" key={p.id}><input type="checkbox" name="person" value={p.id} defaultChecked={event.definition?.allowedPersonIds?.includes(p.id)} />{p.data.firstName} {p.data.lastName}</label>)}<p>Seleciona pelo menos uma ficha.</p></fieldset>}
      
      <details><summary>Autorizar um bloqueio pessoal</summary><label>Bloqueio<AdaptiveSelect value={overrideId} onChange={e => setOverrideId(e.target.value)}><option value="">Sem autorização</option>{setup.data?.windows.filter(w => !w.available).map(w => <option value={w.id} key={w.id}>{agendaDate(w.startsAt)} — {agendaDate(w.endsAt)}</option>)}</AdaptiveSelect></label>{block && <label className="checkbox"><input key={block.id + ':' + block.version} type="checkbox" name="override" />Confirmo este evento apesar deste bloqueio pessoal.</label>}</details><button>Guardar evento</button>
    </fieldset></form><button type="button" className="secondary" disabled={disabled} onClick={onBack}>Voltar aos eventos</button>
  </InformationCard>
}

function EventRoster({ event, disabled, send, people, guard, initialParticipationId }) {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const read = useCallback(signal => apiRequest(`consultations/events/${event.summary.id}/participants?page=${page}`, undefined, { signal }), [event.summary.id, page])
  const roster = useLiveResource('events', `roster:${event.summary.id}:${page}`, read)
  const names = useConsultationNames([...(roster.data?.items.filter(p => p.personId) || []), ...(event.protectedSeats || []).filter(p => p.personId)], selected?.personId ? selected : null, true)
  useEffect(() => {
    const id = initialParticipationId
    if (!id) return
    let active = true
    apiRequest(`consultations/events/${event.summary.id}/participants/${id}`).then(p => { if (active) { setSelected(p); setError('') } }).catch(failure => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [initialParticipationId, event.summary.id])
  async function act(command, retry, cleanup) { const result = await send(command, retry, cleanup); if (result) setSelected(null); return result }
  return <InformationCard title="Participantes" cardId="event-roster" loading={roster.loading} error={roster.error} onRetry={roster.refresh}>
    {error && <p role="alert" className="notice error">{error}</p>}
    {roster.data?.items.map(p => <article className={styles.participant} key={p.id}><p>{p.personId ? names.data?.[p.personId] || 'Ficha de cliente' : p.guestContact ? `${p.guestContact.firstName} ${p.guestContact.lastName}` : 'Participação anónima'} · {p.process.processLabel}{p.protectedSeat ? ' · Vaga protegida' : ''}</p><button className="secondary" disabled={disabled} onClick={() => guard(() => setSelected(p))}>Abrir participação</button></article>)}
    {roster.data?.total > 8 && <nav className="pager"><button disabled={disabled || page === 1} onClick={() => guard(() => setPage(p => p - 1))}>Anterior</button><span>Página {page}</span><button disabled={disabled || page * 8 >= roster.data.total} onClick={() => guard(() => setPage(p => p + 1))}>Seguinte</button></nav>}
    {selected && <div className={styles.editor}>
      <h3>{selected.personId ? names.data?.[selected.personId] || 'Ficha de cliente' : 'Participação sem ficha'}</h3><Participation key={selected.id} participation={selected} event={event} disabled={disabled} send={act} manager people={people} names={names.data} />
      {event.summary.state === 'Performed' && selected.state === 'Confirmed' && <EventAttendanceForm key={'draft:' + selected.id} event={event} participation={selected} disabled={disabled} send={act} />}
      <button className="secondary" disabled={disabled} onClick={() => guard(() => setSelected(null))}>Fechar participação</button>
    </div>}
  </InformationCard>
}

export function Participation({ participation: p, event, disabled, send, manager = false, people, names }) {
  const free = event.summary.isFree === true
  const act = (action, fields = {}) => send({ action, id: p.id, version: p.version, ...fields })
  return <article className={styles.participation}><p>{p.process.processLabel}</p>
    <p>{p.financialState === 'Paid' ? 'Paga' : p.financialState === 'ContributionUndefined' ? 'Por pagar — contribuição por definir' : p.remaining > 0 ? `Por pagar: ${agendaMoney(p.remaining)}` : p.expectationOpen ? 'Aguarda recebimento' : 'Sem dívida'}</p>
    {p.acceptedConditions && <details><summary>Condições aceites na inscrição</summary>{p.acceptedConditions.sections.map(section => <section key={section.title}><h3>{section.title}</h3>{section.paragraphs.map(text => <p key={text}>{text}</p>)}{section.bullets.length > 0 && <ul>{section.bullets.map(text => <li key={text}>{text}</li>)}</ul>}</section>)}</details>}
    {manager && p.canReceive && <FinancialEntryForm
      people={[{ id: p.personId, data: { firstName: names?.[p.personId] || 'Ficha de cliente' } }]} participation={p} disabled={disabled} instant={instant}
      submit={async (e, input) => { e.preventDefault(); await send(input(new FormData(e.currentTarget))) }} />}
    {!manager && free && <p>Participação gratuita.</p>}
    {!p.attendance && p.creditProposals?.some(proposal => !proposal.decision) && <p>Proposta de utilização de crédito: {agendaMoney(p.creditProposals.find(proposal => !proposal.decision).amount)}.</p>}
    {manager && p.expectationOpen && p.referencePrice > 0 && p.balance >= p.referencePrice && <button className="secondary" disabled={disabled} onClick={() => act('UseParticipationCreditForAdvance')}>Validar crédito disponível para o pré-pagamento</button>}
    {manager && p.guestContact && <><p>+{p.guestContact.dialCode} {p.guestContact.phone}</p>{p.guestContact.email && <p>{p.guestContact.email}</p>}{p.state === 'Requested' && <form data-protect-draft onSubmit={e => { e.preventDefault(); const fields = new FormData(e.currentTarget); act('LinkEventGuest', { personId: fields.get('person'), conditionsAccepted: fields.has('verified') }) }}><label>Ficha verificada<AdaptiveSelect name="person" required defaultValue={p.personId || ""}><option value="">Seleciona a ficha</option>{people.data?.map(person => <option key={person.id} value={person.id}>{person.data.firstName} {person.data.lastName}</option>)}</AdaptiveSelect></label><label className="checkbox"><input name="verified" type="checkbox" required />Verifiquei a identidade e confirmo a ficha selecionada.</label><button disabled={disabled}>Aprovar pedido e confirmar inscrição</button><button type="button" className="secondary" disabled={disabled} onClick={() => act('RejectEventGuest')}>Recusar pedido</button></form>}</>}
    {['Confirmed', 'Waiting'].includes(p.state) && !p.attendance && !manager && new Date(event.summary.startsAt) > new Date() && <button className="secondary" disabled={disabled} onClick={() => { if (window.confirm('Confirmas o cancelamento da inscrição?')) act('CancelParticipation') }}>Cancelar inscrição</button>}
    {manager && ['Confirmed', 'Waiting'].includes(p.state) && !p.attendance && <form onSubmit={e => { e.preventDefault(); act('CancelParticipation', { availabilityChoice: new FormData(e.currentTarget).get('availability') }) }}><label>Vaga após cancelamento<AdaptiveSelect name="availability"><option value="Release">Libertar</option><option value="Keep">Proteger</option></AdaptiveSelect></label><button className="secondary" disabled={disabled}>Cancelar inscrição</button></form>}
    {manager && p.protectedSeat && <button className="secondary" disabled={disabled} onClick={() => act('ReleaseEventSeat')}>Libertar vaga protegida</button>}
    {manager && p.state === 'Waiting' && <form data-protect-draft onSubmit={e => { e.preventDefault(); const fields = new FormData(e.currentTarget); act('ConfirmParticipation', { conditionsAccepted: fields.has('overcapacity'), relatedId: fields.get('source') || undefined }) }}><label>Vaga a atribuir<AdaptiveSelect name="source" defaultValue=""><option value="">Usar uma vaga pública disponível</option>{event.protectedSeats?.map(seat => <option key={seat.id} value={seat.id}>Vaga protegida · {names?.[seat.personId] || 'Participação sem ficha'}</option>)}</AdaptiveSelect></label><button disabled={disabled}>Confirmar participação</button></form>}
    {manager && p.financialState === 'ContributionUndefined' && <form data-protect-draft onSubmit={e => { e.preventDefault(); act('DefineParticipationContribution', { amount: Number(new FormData(e.currentTarget).get('amount')) }) }}><label>Valor final da contribuição<input name="amount" type="number" required min="0.01" step="0.01" /></label><button disabled={disabled}>Definir contribuição</button></form>}
    {!free && event.summary.kind !== 'Retreat' && p.state === 'Confirmed' && p.attendance === 'Performed' && p.financialChoice === 'Unpaid' && !p.settlementId && p.remaining > 0 && <CreditSettlementForm record={p} manager={manager} participation disabled={disabled} act={act} />}
    {event.summary.kind === 'Retreat' && <RetreatPayments participation={p} manager={manager} disabled={disabled} act={act} />}
    {p.sharedSummary && <div className={styles.note}><h3>Acompanhamento</h3>{p.sharedSummary}</div>}{manager && p.privateNote && <div className={styles.note}><h3>Nota privada</h3>{p.privateNote}</div>}
    {!manager && p.section === 'Closed' && (!p.archivedAt || p.archivedContentVersion !== p.publicContentVersion) && <button disabled={disabled} onClick={() => act('ArchiveParticipation', { publicContentVersion: p.publicContentVersion })}>Já vi a informação sobre a consulta, posso arquivar.</button>}
  </article>
}
