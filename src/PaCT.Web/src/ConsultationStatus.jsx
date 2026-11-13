import moneyText from './moneyText'
import labels from './consultationLabels'
import { agendaMoney } from './agendaTime'

export default function ConsultationStatus({ consultation, className, showAmount = true, as: Element = 'p' }) {
  const process = consultation.process.processLabel
  const financial = /Aguarda confirmação de recebimento|Falta liquidar/.test(process) ? '' : labels[consultation.financialState]
  const due = showAmount && ['Unpaid', 'ContributionPending'].includes(consultation.financialState) && consultation.amountDue > 0
    ? `: ${agendaMoney(consultation.amountDue)}` : ''
  return <Element className={className} data-typography="process-status">{moneyText(process)}{financial && !process.toLocaleLowerCase('pt-PT').includes(financial.toLocaleLowerCase('pt-PT')) ? moneyText(` · ${financial}${due}`) : ''}</Element>
}
