import { agendaMoney } from './agendaTime'

export default function ConsultationValue({ consultation: c, manager = false }) {
  const mode = c.state === 'Performed' ? c.noDebtReason : c.paymentConditions?.mode || c.financialChoice || c.paymentMode
  const label = mode === 'Gift' ? 'Oferta do pagamento' : mode === 'Free' ? 'Sem pagamento necessário' : null
  if (label) return <p>{label}</p>
  if (manager) return <p>Referência: {agendaMoney(c.referencePrice)} · Valor final: {agendaMoney(c.finalAmount)}</p>
  return <p>{c.state === 'Performed' ? c.finalAmount == null ? 'Valor final por definir' : `Valor final: ${agendaMoney(c.finalAmount)}`
    : mode === 'Contribution' ? 'Contribuição livre, paga depois da consulta.' : `Valor previsto: ${agendaMoney(c.referencePrice)}`}</p>
}
