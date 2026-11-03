import InformationCard from './InformationCard'

export default function EventCapacityConsent({ event, disabled, checked, onChange }) {
  if (event.remaining > 0) return null
  return <InformationCard title="Lotação" headingLevel={3} cardId="event-capacity-consent">
    <p>Lotação: {event.capacity} · Lugares ocupados ou provisórios: {event.occupiedCount}. Depois desta inscrição: {event.occupiedCount + 1}.</p>
    <label className="checkbox"><input type="checkbox" name="overcapacity" required disabled={disabled} {...(onChange ? { checked, onChange: e => onChange(e.target.checked) } : {})} />Confirmo inscrever acima da lotação.</label>
  </InformationCard>
}
