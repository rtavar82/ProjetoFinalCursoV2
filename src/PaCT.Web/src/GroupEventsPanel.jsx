import eventStatusLabel from './eventStatusLabel'
import DateRangeFields from './DateRangeFields'
import AdaptiveSelect from './AdaptiveSelect'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import ClientSearch from './ClientSearch'
import RecordTable from './RecordTable'
import EventCapacityConsent from './EventCapacityConsent'
import ConsultationConversation from './ConsultationConversation'
import ConsultationPaymentHistory from './ConsultationPaymentHistory'
import useConsultationNames from './useConsultationNames'
import InformationCard from './InformationCard'
import AppointmentSummary from './AppointmentSummary'
import Pagination from './Pagination'
import ConsultationDialog from './ConsultationDialog'
import ConsultationConditionsForm, { ConditionsContent } from './ConsultationConditionsForm'
import ClientPaymentPanel from './ClientPaymentPanel'
import { FinancialEntryForm } from './FinancePanel'
import CreditSettlementForm from './CreditSettlementForm'
import EventAttendanceForm from './EventAttendanceForm'
import { RetreatDefinition } from './RetreatForms'
import { agendaDate, agendaMoney, instant, localDate } from './agendaTime'
import styles from './GroupEventsPanel.module.css'


export default function GroupEventsPanel({ manager = false, send, disabled = false, guard = action => action(), feedback, initialEntry, onClose }) {
  const [openedDetail, setDetail] = useState(null)
  const detailId = openedDetail?.summary.id
  const readDetail = useCallback(() => apiRequest('consultations/events/' + detailId), [detailId])
  const latestDetail = useLiveResource('events', 'event-detail:' + detailId, readDetail, !!detailId)
  const detail = detailId ? latestDetail.data || openedDetail : null
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const readSetup = useCallback(signal => apiRequest('consultations/setup', undefined, { signal }), [])
  const setup = useLiveResource('agenda', 'event-services', readSetup, manager && !!editing)
  const open = useCallback(async id => { try { setDetail(await apiRequest('consultations/events/' + id)); setError('') } catch (failure) { setError(failure.message) } }, [])
  const initialEventId = initialEntry?.events ? initialEntry.id : null
  const initialRevision = initialEntry?.revision
  useEffect(() => { if (initialEventId) { let active = true; apiRequest('consultations/events/' + initialEventId).then(value => { if (active) setDetail(value) }).catch(failure => { if (active) setError(failure.message) }); return () => { active = false } } }, [initialEventId, initialRevision])
  function dismiss() { setDetail(null); onClose?.() }
  function close() { guard(dismiss) }
  async function command(input, retry = false, cleanup = null) {
    const result = await send(input, retry, cleanup)
    if (result && detail) { if (!manager && ['UseParticipationCredit', 'DeclareParticipationPayment', 'ArchiveParticipation', 'CancelParticipation'].includes(input.action)) dismiss(); else await open(detail.summary.id) }
    return result
  }
  return <>
    {editing && manager && <ConsultationDialog title="Editar evento" label="Edição do evento" disabled={disabled} onClose={close}>
      <EventEditor key={editing.id} event={editing} setup={setup} disabled={disabled} send={async input => { const result = await command(input); if (result) { await open(editing.id); setEditing(null) } return result }} onBack={() => guard(async () => { await open(editing.id); setEditing(null) })} />
    </ConsultationDialog>}
    {!detail && !editing && <ConsultationDialog title="Grupo ou retiro" label="Detalhe do evento" disabled={disabled} onClose={close}>
      <InformationCard cardId="event-detail-loading" loading={!error} error={error} />
    </ConsultationDialog>}
    {detail && <ConsultationDialog title={detail.summary.title} label="Detalhe do evento" disabled={disabled} onClose={close}>
      <AppointmentSummary consultation={detail.summary} showTitle={false} stateLabel={eventStatusLabel(detail.summary, { manager, participations: manager ? [] : detail.ownParticipations })} typeLabel={detail.summary.kind === 'Retreat' ? 'Retiro' : 'Grupo'} />{feedback}{detail.instructions && <p className={styles.note}>{detail.instructions}</p>}
      {!manager && <>{!detail.summary.hasParticipation && detail.summary.registrationOpen && detail.summary.eligible && (!detail.summary.isFree
        ? <section aria-label="Inscrição na consulta de grupo"><h3>Inscrição na consulta de grupo</h3>{detail.summary.remaining === 0 && <p>O evento está lotado. O pedido entra na fila de desistências; o prazo de pagamento só começa quando a gestão confirmar a entrada.</p>}<p>{detail.paymentConditions?.label}</p><p>{detail.summary.referencePrice === null ? 'Contribuição livre' : agendaMoney(detail.summary.referencePrice)}</p>
          <ConsultationConditionsForm consultation={{ paymentConditions: detail.paymentConditions, balance: detail.balance, referencePrice: detail.summary.referencePrice }} disabled={disabled}
            submitLabel={detail.summary.remaining === 0 ? 'Aceitar condições e pedir entrada na fila de desistências' : detail.paymentConditions?.mode === 'Prepayment' ? 'Confirmar inscrição. De seguida farei este pagamento.' : 'Aceitar condições e confirmar inscrição'}
            onAccept={fields => command({ action: 'JoinEvent', id: detail.summary.id, version: detail.summary.version, choice: detail.summary.remaining === 0 ? 'Waiting' : undefined, ...fields })} /></section>
        : <button disabled={disabled} onClick={() => command({ action: 'JoinEvent', id: detail.summary.id, version: detail.summary.version, choice: detail.summary.remaining === 0 ? 'Waiting' : undefined })}>{detail.summary.remaining === 0 ? 'Pedir entrada na fila de desistências' : 'Confirmar inscrição'}</button>)}{detail.ownParticipations.map(p => <Participation key={p.id} participation={p} event={detail} showStatus={false} disabled={disabled} send={command} />)}</>}
      {manager && <>
        <p>Participantes por fechar: {detail.summary.pendingClosures}</p><EventRoster event={detail} disabled={disabled} send={command} guard={guard} initialParticipationId={initialEntry?.participationId} />
        {['Waiting', 'AwaitingClosure'].includes(detail.summary.state) && <>
          <button className="secondary" disabled={disabled} onClick={() => guard(() => { setEditing({ id: detail.summary.id, version: detail.summary.version, definition: detail.definition }); setDetail(null) })}>Editar evento</button>
          <InformationCard as="form" title="Cancelar evento" headingLevel={3} cardId="event-cancellation" data-protect-draft onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); command({ action: 'CancelEvent', id: detail.summary.id, version: detail.summary.version, choice: fields.get('cancellationReason'), availabilityChoice: fields.get('availability') }) }}><label>Motivo<AdaptiveSelect name="cancellationReason"><option value="Organizer">Decisão da gestão</option><option value="MinimumParticipants">Falta de participantes mínimos</option></AdaptiveSelect></label><label>Horário após cancelamento<AdaptiveSelect name="availability" required defaultValue=""><option value="">Escolhe o destino do horário</option><option value="Release">Libertar</option><option value="Keep">Manter bloqueado</option></AdaptiveSelect></label><button className="secondary" disabled={disabled}>Cancelar evento</button></InformationCard>
          {detail.summary.state === 'AwaitingClosure' && <InformationCard as="form" title="Registar realização" headingLevel={3} cardId="event-outcome" data-protect-draft onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); try { command({ action: 'PerformEvent', id: detail.summary.id, version: detail.summary.version, startsAt: instant(fields.get('start')), endsAt: instant(fields.get('end')) }) } catch (failure) { setError(failure.message) } }}><DateRangeFields key={detail.summary.id} startLabel="Início efetivo (Lisboa)" endLabel="Fim efetivo (Lisboa)" required exclusive defaultValue={{ start: localDate(new Date(detail.summary.startsAt)), end: localDate(new Date(detail.summary.endsAt)) }} /><button disabled={disabled}>Confirmar realização</button></InformationCard>}
        </>}
        {detail.keepBlocked && <button className="secondary" disabled={disabled} onClick={() => command({ action: 'ReleaseEventBlock', id: detail.summary.id, version: detail.summary.version })}>Libertar horário cancelado</button>}
        {detail.summary.state !== 'Cancelled' && <AddParticipant event={detail} disabled={disabled} send={command} />}
      </>}
    </ConsultationDialog>}
  </>
}

function AddParticipant({ event, disabled, send }) {
  const free = event.summary.isFree === true
  const [choice, setChoice] = useState('Confirmed')
  const [client, setClient] = useState(null)
  const [method, setMethod] = useState('NoCharge')
  const [error, setError] = useState('')
  return <InformationCard as="form" title="Adicionar participante" headingLevel={3} cardId="event-add-participant" data-protect-draft onSubmit={e => {
    e.preventDefault(); const fields = new FormData(e.currentTarget); setError('')
    try { send({ action: 'JoinEvent', id: event.summary.id, version: event.summary.version,
      personId: choice === 'Anonymous' ? undefined : client?.id, choice, confirmOvercapacity: fields.has('overcapacity'),
      ...(choice === 'Anonymous' ? { method: free ? 'NoCharge' : method, amount: !free && fields.get('amount') ? Number(fields.get('amount')) : null, method2: fields.get('cashMethod'), ...(!free && method === 'AnonymousPaid' ? { startsAt: instant(fields.get('receivedAt')) } : {}) } : {}),
    }) } catch (failure) { setError(failure.message) }
  }}>{error && <p role="alert">{error}</p>}<fieldset className={styles.eventFields} disabled={disabled}>
    <label>Inscrição<AdaptiveSelect name="choice" value={choice} onChange={e => setChoice(e.target.value)}><option value="Confirmed">Confirmada</option>{event.summary.state !== 'Performed' && <option value="Waiting">Em espera</option>}{event.summary.state === 'Performed' && <option value="Anonymous">Anónima, sem dívida pessoal</option>}</AdaptiveSelect></label>
    {choice !== 'Anonymous' ? <ClientSearch selected={client} onSelect={setClient} disabled={disabled} /> : <>
      {free ? <p>Participação gratuita.</p> : <label>Tratamento financeiro<AdaptiveSelect value={method} onChange={e => setMethod(e.target.value)}><option value="NoCharge">Sem cobrança</option><option value="AnonymousPaid">Pagamento integral já recebido</option></AdaptiveSelect></label>}
      {!free && method === 'AnonymousPaid' && <><label>Valor recebido<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Meio de recebimento<AdaptiveSelect name="cashMethod"><option value="Cash">Dinheiro</option><option value="Transfer">Transferência</option><option value="MbWay">MB WAY</option><option value="Card">Cartão</option><option value="Other">Outro</option></AdaptiveSelect></label><label>Data de recebimento (Lisboa)<input name="receivedAt" type="datetime-local" required /></label></>}
    </>}
    {choice !== 'Waiting' && <EventCapacityConsent event={event.summary} disabled={disabled} />}
    <button disabled={disabled || choice !== 'Anonymous' && !client}>Adicionar participante</button>
  </fieldset></InformationCard>
}

export function EventEditor({ event, setup, disabled, send, onBack, fixedService = false, dates }) {
  const [error, setError] = useState('')
  const [billingMode, setBillingMode] = useState(event.definition?.billingMode || 'Prepayment')
  const [selectedService, setSelectedService] = useState(event.definition?.serviceId || '')
  const service = setup.data?.services.find(s => s.id === selectedService)
  const retreat = service?.serviceKind === 'Retreat'
  const paidOccurrence = service && !retreat && service.paymentMode !== 'Free' && billingMode === 'Prepayment'
  return <InformationCard title={event.id ? 'Editar evento' : 'Criar grupo ou retiro'} cardId="event-editor" loading={setup.loading} error={setup.error}>
    {error && <p role="alert" className="notice error">{error}</p>}
    <form data-protect-draft onSubmit={async e => { e.preventDefault(); const fields = new FormData(e.currentTarget); setError(''); try {
      const start = dates ? dates.from + 'T' + fields.get('start') : fields.get('start')
      const end = dates ? dates.to + 'T' + fields.get('end') : fields.get('end')
      if (!start || !end || end <= start) throw new Error('O fim do evento deve ser posterior ao início. Corrige a data e a hora de fim.')
      await send({ action: 'SaveEvent', id: event.id, version: event.version || 0, event: { serviceId: selectedService, startsAt: instant(start), endsAt: instant(end), publicLocation: fields.get('location'), capacity: Number(fields.get('capacity')), published: true, billingMode: !retreat && service?.paymentMode !== 'Free' ? billingMode : null, minimumParticipants: Number(fields.get('minimum')), allowClientCredit: fields.has('allowClientCredit'), promoted: fields.has('promoted'), promotionText: fields.get('promotionText'), allowedPersonIds: null, ...(!retreat && paidOccurrence ? { totalPrice: Number(fields.get('totalPrice')) } : {}), ...(retreat ? { program: fields.get('program'), totalPrice: Number(fields.get('totalPrice')), cancellationConditions: fields.get('cancellation') } : {}) }, conditionsAccepted: fields.has('promoted') })
    } catch (failure) { setError(failure.message) } }}><fieldset className={styles.eventFields} disabled={disabled}>
      {!fixedService && <label>Tipo de grupo ou retiro<AdaptiveSelect aria-label="Tipo de grupo ou retiro" name="service" required value={selectedService} onChange={e => setSelectedService(e.target.value)}><option value="">Escolhe grupo ou retiro</option>{setup.data?.services.filter(s => s.serviceKind === 'Group' || s.serviceKind === 'Retreat').map(s => <option value={s.id} key={s.id}>{s.title}</option>)}</AdaptiveSelect></label>}<DateRangeFields type={dates ? 'time' : 'datetime-local'} startLabel={dates ? 'Hora de início (Lisboa)' : 'Início (Lisboa)'} endLabel={dates ? 'Hora de fim (Lisboa)' : 'Fim (Lisboa)'} required exclusive ordered={!dates || dates.from === dates.to} defaultValue={{ start: event.definition?.startsAt ? localDate(new Date(event.definition.startsAt)).slice(dates ? 11 : 0) : '', end: event.definition?.endsAt ? localDate(new Date(event.definition.endsAt)).slice(dates ? 11 : 0) : event.definition?.startsAt ? localDate(new Date(event.definition.startsAt)).slice(dates ? 11 : 0) : '' }} onChange={() => setError('')} /><label>Local do evento<AdaptiveSelect aria-label="Local do evento" name="location" required defaultValue={event.definition?.publicLocation || ''}><option value="">Escolhe o local</option><option>Montijo</option><option>Vila Nova de São Bento</option></AdaptiveSelect></label><label>Mínimo de participantes<input name="minimum" type="number" min="1" max="10000" required defaultValue={event.definition?.minimumParticipants ?? ''} /></label><label>Lotação<input name="capacity" type="number" min="1" max="10000" required defaultValue={event.definition?.capacity || ''} /></label>
      {!retreat && service && service.paymentMode !== 'Free' && <label>Pagamento da consulta de grupo<AdaptiveSelect name="billingMode" value={billingMode} onChange={event => setBillingMode(event.target.value)}><option value="Prepayment">Pré-pagamento</option><option value="Contribution">Contribuição livre, depois do grupo</option></AdaptiveSelect></label>}
      {!retreat && paidOccurrence && <label>Preço por participante<input aria-label="Preço por participante" name="totalPrice" type="number" min="0.01" step="0.01" required defaultValue={event.definition?.totalPrice ?? ''} /></label>}
      {service?.paymentMode === 'Free' && <p>Participação gratuita, sem contribuição.</p>}
      {retreat && <RetreatDefinition definition={event.definition} disabled={disabled} />}
      {service?.paymentMode !== 'Free' && (retreat || billingMode === 'Prepayment') && <InformationCard title="Utilização de crédito pelo cliente" headingLevel={3} cardId="event-credit-authorization"><label className="checkbox"><input type="checkbox" name="allowClientCredit" defaultChecked={event.definition?.allowClientCredit || false} />Permitir utilizar crédito disponível na inscrição</label><p>A utilização é opcional e só aparece ao cliente com crédito autorizado disponível.</p></InformationCard>}
      <label className="checkbox"><input type="checkbox" name="promoted" />Divulgar também em Partilhas</label><label>Texto de divulgação (opcional)<textarea name="promotionText" maxLength="2000" defaultValue={event.definition?.promotionText || ''} /></label>
      <button>Publicar e sair</button>
    </fieldset></form><button type="button" className="secondary" disabled={disabled} onClick={onBack}>Voltar aos eventos</button>
  </InformationCard>
}

function EventRoster({ event, disabled, send, guard, initialParticipationId }) {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const read = useCallback(signal => apiRequest(`consultations/events/${event.summary.id}/participants?page=${page}`, undefined, { signal }), [event.summary.id, page])
  const roster = useLiveResource('events', `roster:${event.summary.id}:${page}`, read)
  const names = useConsultationNames(roster.data?.items.filter(p => p.personId) || [], selected?.personId ? selected : null, true)
  useEffect(() => {
    const id = initialParticipationId
    if (!id) return
    let active = true
    apiRequest(`consultations/events/${event.summary.id}/participants/${id}`).then(p => { if (active) { setSelected(p); setError('') } }).catch(failure => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [initialParticipationId, event.summary.id])
  async function act(command, retry, cleanup) { const result = await send(command, retry, cleanup); if (result) {
    if (command.action === 'RegisterParticipation') setSelected(await apiRequest(`consultations/events/${event.summary.id}/participants/${command.id}`))
    else setSelected(null)
  } return result }
  return <InformationCard title="Participantes" cardId="event-roster" loading={roster.loading} error={roster.error} onRetry={roster.refresh}>
    {error && <p role="alert" className="notice error">{error}</p>}
    <RecordTable caption="Participantes do evento" rows={roster.data?.items || []} rowKey={p => p.id} columns={[
      { key: 'client', label: 'Cliente', render: p => p.personId ? names.data?.[p.personId] || 'Ficha de cliente' : p.guestContact ? `${p.guestContact.firstName} ${p.guestContact.lastName}` : 'Participação anónima' },
      { key: 'attendance', label: 'Participação', render: p => p.process.stateLabel },
      { key: 'financial', label: 'Situação financeira', render: p => p.financialLabel },
      { key: 'remaining', label: 'Por pagar', render: p => p.financialState === 'ContributionUndefined' ? 'Por definir' : agendaMoney(p.remaining) },
      { key: 'action', label: 'Ação', render: p => <button className="text-button" disabled={disabled} onClick={() => guard(() => setSelected(p))}>Abrir e tratar</button> },
    ]} />
    <Pagination total={roster.data?.total} page={page} disabled={disabled} onChange={next => guard(() => setPage(next))} />
    {selected && <ConsultationDialog title={event.summary.title} label="Detalhe da participação" disabled={disabled} onClose={() => guard(() => setSelected(null))}>
      <AppointmentSummary consultation={event.summary} showTitle={false} stateLabel={selected.process.processLabel} typeLabel={event.summary.kind === 'Retreat' ? 'Retiro' : 'Grupo'} />
      <p>{selected.personId ? names.data?.[selected.personId] || 'Ficha de cliente' : 'Participação sem ficha'}</p>
      <Participation key={selected.id + ':' + selected.version} participation={selected} event={event} disabled={disabled} send={act} manager names={names.data} showStatus={false} />
      {selected.canClose && <EventAttendanceForm key={'draft:' + selected.id} event={event} participation={selected} disabled={disabled} send={act} />}
    </ConsultationDialog>}

  </InformationCard>
}

export function Participation({ participation: p, event, disabled, send, manager = false, names, showStatus = true }) {
  const [client, setClient] = useState(null)
  const [conversation, setConversation] = useState(false)
  const presented = useRef(new Set())
  const onPresented = useCallback(items => { for (const item of items) if (!item.own) presented.current.add(item.id) }, [])
  const act = (action, fields = {}) => send({ action, id: p.id, version: p.version, ...fields })
  const paymentVisible = p.conditionsPending || p.remaining > 0 || p.financialState === 'ContributionUndefined' || !!p.paymentDeclaredAt
  const clientPayment = { ...p, state: p.attendance === 'Performed' ? 'Performed' : p.state, financialChoice: event.summary.paymentMode,
    paymentConditions: event.paymentConditions, paymentInformation: p.acceptedConditions?.paymentInformation || event.paymentConditions?.paymentInformation,
    amountDue: p.remaining, actions: [...(p.conditionsPending ? ['Accept'] : []), ...(!p.conditionsPending && p.clientCreditAvailable > 0 ? ['UseAuthorizedCredit'] : []),
      ...(!p.conditionsPending && !p.paymentDeclaredAt && p.state === 'Confirmed' && paymentVisible ? ['DeclarePayment'] : [])] }
  const clientAct = (action, fields) => act(({ Accept: 'AcceptParticipationConditions', DeclarePayment: 'DeclareParticipationPayment' })[action] || action, fields)

  return <div className={styles.participation}>
    {showStatus && <AppointmentSummary consultation={event.summary} showTitle={false} stateLabel={eventStatusLabel(event.summary, { manager, participation: p })} typeLabel={event.summary.kind === 'Retreat' ? 'Retiro' : 'Grupo'} />}
    {!manager && paymentVisible && <ClientPaymentPanel consultation={clientPayment} disabled={disabled} act={clientAct} participation />}
    {p.acceptedConditions && <details><summary>Condições aceites na inscrição</summary><ConditionsContent conditions={p.acceptedConditions} /></details>}
    {manager && p.canReceive && <FinancialEntryForm people={[{ id: p.personId, data: { firstName: names?.[p.personId] || 'Ficha de cliente' } }]} participation={{ ...p, paymentMode: event.summary.paymentMode }} disabled={disabled} instant={instant} reviewBeforeSubmit submit={async (e, input) => { e.preventDefault(); return send(input(new FormData(e.currentTarget))) }} />}
    {manager && (p.remaining > 0 || p.financialState === 'ContributionUndefined') && <InformationCard title="Pagamento da participação" headingLevel={3} cardId="participation-payment">
      <p>Por pagar: <strong>{p.financialState === 'ContributionUndefined' ? 'Contribuição por definir' : agendaMoney(p.remaining)}</strong></p>
      {p.paymentDeclaredAt && <p>Aguarda confirmação de recebimento pela terapeuta.</p>}
    </InformationCard>}
    {manager && p.canSettle && <CreditSettlementForm record={p} manager={manager} participation disabled={disabled} act={act} />}
    {manager && p.guestContact && <><p>+{p.guestContact.dialCode} {p.guestContact.phone}</p>{p.state === 'Requested' && <InformationCard title="Ficha do participante" cardId="event-guest-identity"><ClientSearch selected={client} onSelect={setClient} disabled={disabled} /><button disabled={disabled || !client} onClick={() => act('LinkEventGuest', { personId: client.id, conditionsAccepted: true })}>Aprovar inscrição na ficha verificada</button><button className="secondary" disabled={disabled} onClick={() => act('RejectEventGuest')}>Recusar inscrição</button></InformationCard>}</>}
    {['Confirmed', 'Waiting'].includes(p.state) && !p.attendance && event.summary.registrationOpen && <button className="secondary" disabled={disabled} onClick={() => { if (window.confirm(p.state === 'Waiting' ? 'Desistir deste pedido na fila?' : 'Cancelar a inscrição, libertar a vaga e repor o crédito liquidado?')) act('CancelParticipation') }}>{p.state === 'Waiting' ? 'Desistir da fila' : 'Cancelar inscrição'}</button>}
    {manager && (p.state === 'Waiting' || p.canRegisterParticipation) && <InformationCard as="form" title={p.canRegisterParticipation ? 'Registar participação' : 'Fila de desistências'} headingLevel={3} cardId="event-waitlist-confirmation" onSubmit={e => { e.preventDefault(); act(p.canRegisterParticipation ? 'RegisterParticipation' : 'ConfirmParticipation', { confirmOvercapacity: new FormData(e.currentTarget).has('overcapacity') }) }}>
      {p.waitlistPosition && <p>Posição na fila: {p.waitlistPosition} · Pedido: {agendaDate(p.createdAt)}</p>}
      <EventCapacityConsent event={event.summary} disabled={disabled} />
      <button disabled={disabled || p.state === 'Waiting' && p.waitlistPosition > 1}>{p.canRegisterParticipation ? 'Registar participação' : 'Confirmar inscrição'}</button>
    </InformationCard>}
    {!manager && p.state === 'Waiting' && <p>Estás na fila de desistências, por ordem do pedido. Aguarda a confirmação da terapeuta; ainda não tens de pagar.</p>}
    {(manager || !paymentVisible) && <ConsultationPaymentHistory entries={p.paymentHistory || []} />}
    {p.photoIds?.map((photoId, index) => <img className={styles.photo} key={photoId} src={`/api/consultations/${p.id}/photos/${photoId}`} alt={`Imagem partilhada ${index + 1}`} />)}
    {p.sharedSummary && <InformationCard title="Informação partilhada" cardId="event-shared-information"><p className="shared-consultation-note">{p.sharedSummary}</p></InformationCard>}
    {manager && p.privateNote && <InformationCard title="Nota privada — apenas gestão" cardId="event-private-information"><p className="shared-consultation-note">{p.privateNote}</p></InformationCard>}
    {p.attendance === 'Performed' && <><a href={'#acompanhamento-' + p.id} onClick={e => { e.preventDefault(); setConversation(true) }}>Abrir conversas de acompanhamento</a>{conversation && <ConsultationConversation id={p.id} manager={manager} onMessagesPresented={onPresented} />}</>}
    {!manager && p.canArchive && <button disabled={disabled} onClick={() => act('ArchiveParticipation', { publicContentVersion: p.publicContentVersion, ...(presented.current.size ? { messageIds: [...presented.current] } : {}) })}>{p.attendance === 'Performed' ? 'Vi as informações do acompanhamento - quero arquivar' : 'Arquivar registo'}</button>}
  </div>
}
