import moneyText from './moneyText'
import DisclosureSummary from './DisclosureSummary'
import AppArrow from './AppArrow'
import { useCallback, useRef, useState } from 'react'
import ActionButton from './ActionButton'
import AppointmentCard from './AppointmentCard'
import AppointmentSummary from './AppointmentSummary'
import CardGrid from './CardGrid'
import ClientSearch from './ClientSearch'
import InformationCard from './InformationCard'
import ManagerSchedulingDialog from './ManagerSchedulingDialog'
import Pagination from './Pagination'
import RecordTable from './RecordTable'
import { agendaDate, agendaMoney } from './agendaTime'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'

const correctionColumns = [
  { key: 'label', label: 'Valor', render: row => row.label },
  { key: 'before', label: 'Antes', render: row => agendaMoney(row.before) },
  { key: 'after', label: 'Depois', render: row => <strong>{moneyText(agendaMoney(row.after))}</strong> },
]

export default function ConsultationPriceCorrectionDialog({ selectedClient, disabled, send, feedback, clearFeedback, guard, onClose }) {
  const [client, setClient] = useState(selectedClient)
  const [page, setPage] = useState(1)
  const [consultationId, setConsultationId] = useState(null)
  const [reviewing, setReviewing] = useState(false)
  const person = client?.id
  const query = new URLSearchParams({ section: 'Performed', priceCorrectable: 'true', personId: person || '', page }).toString()
  const readList = useCallback(signal => apiRequest('consultations?' + query, undefined, { signal }), [query])
  const list = useLiveResource('consultations', query, readList, !!person && !consultationId)
  const readDetail = useCallback(signal => apiRequest('consultations/' + consultationId, undefined, { signal }), [consultationId])
  const detail = useLiveResource('consultations', 'detail:' + consultationId, readDetail, !!consultationId)
  const locked = disabled || reviewing
  const clientName = client && [client.data.firstName, client.data.lastName].filter(Boolean).join(' ')

  return <ManagerSchedulingDialog title="Retificar valor de consulta" disabled={locked} onClose={() => guard(onClose)}>
    {feedback}
    {!consultationId ? <>
      <ClientSearch purpose="finance" ariaLabel="Cliente da retificação" selected={client} disabled={locked}
        onSelect={value => { setClient(value); setPage(1) }} />
      {person && <InformationCard title="Escolher consulta" cardId="price-correction-consultations" loading={list.loading} error={list.error} onRetry={list.refresh}>
        {list.data?.total === 0 && <p>Esta ficha não tem consultas elegíveis para retificação.</p>}
        {!!list.data?.total && <><CardGrid>{list.data.items.map(consultation => <AppointmentCard key={consultation.id}
          consultation={consultation} financialLabel={'Valor final: ' + agendaMoney(consultation.finalAmount)}
          actionLabel="Selecionar consulta" onOpen={setConsultationId} disabled={locked} />)}</CardGrid>
          <Pagination total={list.data.total} pageSize={list.data.pageSize} page={page} disabled={locked}
            label="Páginas das consultas para retificação" onChange={setPage} />
        </>}
      </InformationCard>}
    </> : <>
      <ActionButton variant="text" disabled={locked} onClick={() => guard(() => setConsultationId(null))}>Voltar à escolha da consulta</ActionButton>
      {(detail.loading || detail.error) && <InformationCard cardId="price-correction-status" loading={detail.loading} error={detail.error} onRetry={detail.refresh} />}
      {detail.data && <PriceCorrectionForm key={consultationId} consultation={detail.data} clientName={clientName}
        disabled={locked || detail.refreshing || !!detail.error} onReviewing={setReviewing} refresh={detail.refresh} send={send} clearFeedback={clearFeedback} />}
    </>}
  </ManagerSchedulingDialog>
}

function PriceCorrectionForm({ consultation, clientName, disabled, onReviewing, refresh, send, clearFeedback }) {
  const [review, setReview] = useState(null)
  const [error, setError] = useState('')
  const form = useRef(null)
  const working = useRef(false)
  const eligible = consultation.actions?.includes('CorrectFinalAmount')
  const stale = review && (review.version !== consultation.version || review.balanceBefore !== consultation.balance)

  async function preview(event) {
    event.preventDefault()
    if (!eligible || disabled || working.current) return
    clearFeedback()
    const values = new FormData(event.currentTarget)
    const amount = Number(values.get('amount'))
    const reason = values.get('reason').trim()
    if (!reason) { setError('Indica o motivo da retificação.'); return }
    if (amount === consultation.finalAmount) { setError('O novo valor deve ser diferente do valor atual.'); return }
    working.current = true
    onReviewing(true)
    setError('')
    try {
      const result = await apiRequest('consultations/' + consultation.id + '/price-correction-preview', { amount, version: consultation.version })
      const figures = [result.previousAmount, result.debtBefore, result.debtAfter, result.balanceBefore, result.balanceAfter, result.creditToRestore]
      if (result.version !== consultation.version || result.amount !== amount || !figures.every(Number.isFinite))
        throw new Error('Não foi possível confirmar o resumo da retificação. Volta a tentar.')
      setReview({ ...result, reason })
    } catch (failure) {
      setError(failure.message)
      if (failure.status === 409) refresh()
    } finally {
      working.current = false
      onReviewing(false)
    }
  }

  async function confirm() {
    if (disabled || working.current || !eligible || !review || stale) return
    working.current = true
    try {
      await send({ action: 'CorrectFinalAmount', id: consultation.id, version: review.version,
        amount: review.amount, expectedBalance: review.balanceBefore, reason: review.reason }, false, () => {
        form.current?.reset()
        setReview(null)
      }, failure => {
        if (failure.status === 409) { setReview(null); refresh() }
      })
    } finally { working.current = false }
  }

  return <>
    <InformationCard cardId="price-correction-selection">
      <AppointmentSummary consultation={consultation} clientName={clientName} />
      <p>Valor final atual: <strong>{moneyText(agendaMoney(consultation.finalAmount))}</strong></p>
      {!eligible && <p role="status">Esta consulta já não está disponível para retificação.</p>}
    </InformationCard>
    <form ref={form} hidden={!!review || !eligible} data-protect-draft onSubmit={preview}>
      <fieldset disabled={disabled}>
        <label>Novo valor final<input name="amount" type="number" required min="0.01" max="1000000" step="0.01" /></label>
        <label>Motivo privado<textarea name="reason" required maxLength="2000" /></label>
      </fieldset>
      {error && <p className="notice error" role="alert">{error}</p>}
      <ActionButton type="submit" disabled={disabled}>Rever antes de confirmar</ActionButton>
    </form>
    {review && <InformationCard title="Rever retificação" cardId="price-correction-review">
      <RecordTable caption="Efeito da retificação" columns={correctionColumns} rowKey={row => row.label} rows={[
        { label: 'Valor final', before: review.previousAmount, after: review.amount },
        { label: 'Por pagar', before: review.debtBefore, after: review.debtAfter },
        { label: 'Saldo do cliente', before: review.balanceBefore, after: review.balanceAfter },
      ]} />
      {review.creditToRestore > 0 && <p>Crédito a repor: <strong>{moneyText(agendaMoney(review.creditToRestore))}</strong></p>}
      <p>Motivo privado: {review.reason}</p>
      {stale && <p className="notice" role="status">Os dados mudaram. Volta à edição e revê os valores atuais.</p>}
      <div className="button-row">
        <ActionButton variant="secondary" disabled={disabled} onClick={() => { setReview(null); refresh() }}>Voltar à edição</ActionButton>
        <ActionButton disabled={disabled || stale || !eligible} onClick={confirm}>Confirmar retificação</ActionButton>
      </div>
    </InformationCard>}
    {!!consultation.priceHistory?.length && <InformationCard cardId="price-correction-history">
      <details><DisclosureSummary>Histórico de retificações</DisclosureSummary>
        <ol>{[...consultation.priceHistory].reverse().map(entry => <li key={entry.id}>
          <p><time dateTime={entry.at}>{agendaDate(entry.at)}</time> · {moneyText(agendaMoney(entry.previousAmount))} <AppArrow direction="right" /> <strong>{moneyText(agendaMoney(entry.amount))}</strong></p>
          <p>Motivo privado: {entry.reason}</p>
        </li>)}</ol>
      </details>
    </InformationCard>}
  </>
}
