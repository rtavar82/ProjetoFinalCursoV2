import AdaptiveSelect from './AdaptiveSelect'
import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import ClientSearch from './ClientSearch'
import { canBookForClient } from './clientBookingOptions'
import InformationCard from './InformationCard'
import AppointmentSummary from './AppointmentSummary'
import CreditAuthorizationCard from './CreditAuthorizationCard'
import ConsultationDialog from './ConsultationDialog'
import WhatsAppMessage from './WhatsAppMessage'
import { agendaDate } from './agendaTime'
import styles from './GuestRequests.module.css'

export default function GuestRequests({ send, disabled, guard, onCreateClient, feedback, initialId, onClose }) {
  const [openedDetail, setDetail] = useState(null)
  const detailId = openedDetail?.id
  const readDetail = useCallback(() => apiRequest('consultations/guests/' + detailId), [detailId])
  const latestDetail = useLiveResource('guestRequests', 'guest-detail:' + detailId, readDetail, !!detailId)
  const detail = detailId ? latestDetail.data || openedDetail : null
  const changed = !!detail && detail.version !== openedDetail.version
  const [error, setError] = useState('')
  useEffect(() => {
    if (!initialId) return
    let active = true
    apiRequest('consultations/guests/' + initialId).then(value => { if (active) setDetail(value) }).catch(failure => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [initialId])
  function dismiss() { setDetail(null); onClose?.() }
  async function decide(action, values = {}) {
    const result = await send({ action, id: detail.id, version: detail.version, ...values })
    if (result) dismiss()
  }
  return <>
    {!detail && <ConsultationDialog title="Pedido sem conta" label="Pedido de consulta" disabled={disabled} onClose={() => guard(dismiss)}><InformationCard cardId="guest-detail-loading" loading={!error} error={error} /></ConsultationDialog>}
    {detail && <ConsultationDialog title={detail.serviceTitle} label="Pedido de consulta" disabled={disabled} onClose={() => guard(dismiss)}>
      <AppointmentSummary consultation={detail} showTitle={false} stateLabel={detail.process.processLabel} typeLabel="Pedido sem conta" clientName={`${detail.contact.firstName} ${detail.contact.lastName}`} />
      {feedback}
      <p>+{detail.contact.dialCode} {detail.contact.phone}</p>{detail.contact.email && <p>{detail.contact.email}</p>}
      {detail.contact.locality && <p>Localidade: {detail.contact.locality}</p>}
      <WhatsAppMessage contact={detail.contact} startsAt={detail.startsAt} disabled={disabled || !!latestDetail.error} />
      {['Requested', 'InTreatment'].includes(detail.state) && <>
        {changed && <p className="notice" role="status">O pedido mudou entretanto. Fecha e volta a abrir antes de decidir. O preenchimento foi mantido.</p>}
        <GuestApproval key={`${openedDetail.id}:${openedDetail.version}`} detail={openedDetail} disabled={disabled || changed} decide={decide}
          onCreateClient={onCreateClient && (() => guard(onCreateClient))} />
        <button type="button" className="secondary" disabled={disabled} onClick={() => { if (window.confirm('Confirmas a recusa deste pedido?')) decide('RejectGuestRequest') }}>Recusar pedido</button>
      </>}
      {detail.history.length > 0 && <details><summary>Histórico do pedido</summary>{detail.history.map((entry, index) => <p key={`${entry.at}:${index}`}>{agendaDate(entry.at)} · {({ StartGuestTreatment: 'Em tratamento', LinkGuestRequest: 'Ficha associada', RejectGuestRequest: 'Recusado' })[entry.action]}</p>)}</details>}
    </ConsultationDialog>}
  </>
}

function GuestApproval({ detail, disabled, decide, onCreateClient }) {
  const [choice, setChoice] = useState(detail.paymentMode || 'Postpayment')
  const [selected, setSelected] = useState(null)
  const [keepSeparate, setKeepSeparate] = useState(false)
  const [verified, setVerified] = useState(false)
  const identity = detail.identity
  const coincident = identity?.hasCoincidences === true
  const personId = identity?.personId || detail.personId
  function choose(person) { setSelected(person); setVerified(false); setKeepSeparate(false) }
  function approve(event) {
    event.preventDefault()
    decide('LinkGuestRequest', { personId: selected?.id || personId, choice, ...(new FormData(event.currentTarget).has('allowClientCredit') && { allowClientCredit: true }),
      conditionsAccepted: coincident && (keepSeparate || verified),
      ...(identity && { guestIdentity: { sourceVersion: identity.sourceVersion, reviewVersion: identity.reviewVersion,
        targetVersion: selected?.version ?? null, keepSeparate } }) })
  }
  return <form data-protect-draft onSubmit={approve} className={styles.approval}>
    <label>Método de pagamento para este cliente pagar a consulta<AdaptiveSelect name="choice" disabled={disabled || !!detail.acceptedAt} value={choice} onChange={event => setChoice(event.target.value)}>
      {[...new Set([detail.paymentMode || 'Postpayment', 'Postpayment', 'Gift'])].map(value => <option key={value} value={value}>{({ Prepayment: 'Pré-pagamento', Postpayment: 'Pagamento posterior', Contribution: 'Contribuição livre', Free: 'Gratuita', Gift: 'Oferta de pagamento' })[value]}</option>)}
    </AdaptiveSelect></label>
    {choice === 'Prepayment' && <CreditAuthorizationCard key={selected?.id || personId} personId={selected?.id || personId} amount={detail.referencePrice} disabled={disabled} />}
    {coincident && <section className={styles.identity} aria-label="Contactos coincidentes">
      <p className="notice" role="status">Existem contactos coincidentes com outras fichas. Esta ocorrência também está em Clientes.</p>
      <h3>Pretendes unir estes dados registados pelo visitante a um cliente que já tenha registo?</h3>
      <details className={styles.search}><summary>Pesquisar cliente para associar</summary>
        <ClientSearch canSelect={canBookForClient} selected={selected} onSelect={choose} disabled={disabled || keepSeparate} unavailableIds={[personId]} />
      </details>
      {selected && <><p>Ao aprovar, o pedido fica associado à ficha escolhida. Os dados dessa ficha são mantidos e a ficha criada para este pedido deixa de estar ativa.</p>
        <label className="checkbox"><input type="checkbox" checked={verified} required={!keepSeparate} disabled={disabled} onChange={event => setVerified(event.target.checked)} />Verifiquei que é a mesma pessoa e confirmo a ficha selecionada.</label></>}
      <label className="checkbox"><input type="checkbox" checked={keepSeparate} disabled={disabled} onChange={event => { setKeepSeparate(event.target.checked); setSelected(null); setVerified(false) }} />São pessoas diferentes. Manter a ficha deste pedido.</label>
    </section>}
    {onCreateClient && <button type="button" className="secondary" disabled={disabled} onClick={onCreateClient}>Criar ficha em Clientes</button>}
    <button disabled={disabled || coincident && !keepSeparate && !(selected && verified)}>Aprovar pedido</button>
  </form>
}
