import { useState } from 'react'
import ActionButton from './ActionButton'
import AdaptiveSelect from './AdaptiveSelect'
import ExpenseActivitySearch from './ExpenseActivitySearch'
import InformationCard from './InformationCard'
import useExpenseActivitySearch from './useExpenseActivitySearch'
import { agendaDate, agendaMoney } from './agendaTime'

const labels = { Keep: 'Manter no evento cancelado', Reassign: 'Transferir para outra atividade', General: 'Classificar como despesa geral' }

export default function CancelledExpenseReview({ item, line, version, disabled, onConfirm }) {
  const [decision, setDecision] = useState('')
  const [destination, setDestination] = useState(null)
  const [reason, setReason] = useState('')
  const [review, setReview] = useState(null)
  const lookup = useExpenseActivitySearch(decision === 'Reassign' && !review)
  const { allocation, lineIndex, allocationIndex } = item
  return <InformationCard as="form" title="Rever gasto de evento cancelado" headingLevel={3} data-protect-draft
    cardId={`cancelled-expense-${lineIndex}-${allocationIndex}`} onSubmit={async event => {
      event.preventDefault()
      if (disabled || !decision || !reason.trim() || (decision === 'Reassign' && !destination)) return
      if (!review) { setReview({ version }); return }
      try {
        await onConfirm({ action: 'ReviewCancelledEvent', version: review.version, reason: reason.trim(), cancelledEvent: {
          lineIndex, allocationIndex, decision, activityKind: destination?.kind, activityId: destination?.id
        } })
      } catch { /* Keep the selected action and reason until the operation succeeds. */ }
    }}>
    <p>{line.description} · <strong>{agendaMoney(allocation.amount)}</strong></p>
    <p>{allocation.activity.title} · {agendaDate(allocation.activity.startsAt)}</p>
    {review ? <><p><strong>{labels[decision]}</strong>{destination && ' · ' + destination.title}</p><p>Motivo: {reason}</p>
      <p>A decisão altera apenas a repartição do gasto.</p></> : <>
      <label>O que fazer com este gasto<AdaptiveSelect value={decision} required disabled={disabled} onChange={event => { setDecision(event.target.value); setDestination(null) }}>
        <option value="">Escolhe uma opção</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </AdaptiveSelect></label>
      {decision === 'Reassign' && (destination
        ? <p>{destination.title} · {agendaDate(destination.startsAt)} <ActionButton variant="text" disabled={disabled} onClick={() => setDestination(null)}>Alterar atividade</ActionButton></p>
        : <ExpenseActivitySearch lookup={lookup} disabled={disabled} onSelect={setDestination} />)}
      <label>Motivo<textarea value={reason} maxLength="2000" required disabled={disabled} onChange={event => setReason(event.target.value)} /></label>
    </>}
    <div className="button-row">{review && <ActionButton variant="secondary" disabled={disabled} onClick={() => setReview(null)}>Voltar atrás</ActionButton>}
      <ActionButton type="submit" disabled={disabled || !decision || !reason.trim() || (decision === 'Reassign' && !destination)}>
        {review ? 'Confirmar decisão' : 'Rever antes de confirmar'}
      </ActionButton></div>
  </InformationCard>
}
