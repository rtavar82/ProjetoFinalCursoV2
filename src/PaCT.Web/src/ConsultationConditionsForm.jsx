import { useState } from 'react'
import PublicPaymentMethods from './PublicPaymentMethods'
import styles from './ConsultationConditionsForm.module.css'
import { agendaMoney } from './agendaTime'

export default function ConsultationConditionsForm({ consultation, disabled, manager = false, onAccept, submitLabel }) {
  const [acceptedVersion, setAcceptedVersion] = useState(null), [error, setError] = useState('')
  const [useCredit, setUseCredit] = useState(false), [creditAmount, setCreditAmount] = useState('')
  const conditions = consultation.paymentConditions
  const version = conditions?.version || consultation.termsVersion || ''
  const accepted = acceptedVersion !== null && acceptedVersion === version
  const advance = (conditions?.mode || consultation.financialChoice || consultation.paymentMode) === 'Prepayment'
  async function submit(event) {
    event.preventDefault()
    if (disabled) return
    if (!accepted) { setError('Confirma que leste e aceitas as condições apresentadas.'); return }
    const fields = new FormData(event.currentTarget)
    setError('')
    await onAccept({ conditionsAccepted: true, termsVersion: conditions?.version || consultation.termsVersion,
      ...(!manager && useCredit ? { amount: Number(creditAmount) } : {}),
      ...(manager && { reason: fields.get('reason') }) })
  }
  return <details className={styles.conditions}>
    <summary>{conditions?.paymentInformation || advance ? 'Ler condições de pagamento' : 'Ler condições da consulta'}</summary>
    {conditions?.sections ? conditions.sections.map(section => <section key={section.title}>
      <h3>{section.title}</h3>{section.paragraphs.map(text => <p key={text}>{text}</p>)}
      {section.bullets.length > 0 && <ul>{section.bullets.map(text => <li key={text}>{text}</li>)}</ul>}
    </section>) : <p>{consultation.terms}</p>}
    {conditions?.paymentInformation && <PublicPaymentMethods information={conditions.paymentInformation} advance={advance} />}
    <form data-protect-draft aria-label="Aceitar as condições da consulta" onSubmit={submit}>
      {error && <p role="alert" className="notice error">{error}</p>}
      {!manager && advance && consultation.balance > 0 && consultation.referencePrice > 0 && <><label className="checkbox"><input type="checkbox" name="useCredit" checked={useCredit} onChange={event => { setUseCredit(event.target.checked); if (event.target.checked && !creditAmount) setCreditAmount(String(Math.min(consultation.balance, consultation.referencePrice))) }} />Proponho utilizar crédito disponível.</label>{useCredit && <><label>Crédito que proponho utilizar<input name="creditAmount" type="number" required min="0.01" step="0.01" max={Math.min(consultation.balance, consultation.referencePrice)} value={creditAmount} onChange={event => setCreditAmount(event.target.value)} /></label><p>Crédito disponível: {agendaMoney(consultation.balance)}. Diferença a enviar: {agendaMoney(Math.max(0, consultation.referencePrice - Number(creditAmount || 0)))}.</p><p>A utilização do crédito depende da confirmação da gestão.</p></>}</>}
      <label className="checkbox"><input type="checkbox" name="accept" checked={accepted} disabled={disabled} onChange={event => { setAcceptedVersion(event.target.checked ? version : null); if (event.target.checked) setError('') }} />{manager ? 'O cliente comunicou que aceita as condições apresentadas.' : conditions?.paymentInformation || advance ? 'Li e aceito as condições e a forma de pagamento apresentada.' : 'Li e aceito as condições da consulta.'}</label>
      {manager && <label>Como e quando o cliente comunicou a aceitação?<input name="reason" required maxLength="1000" disabled={disabled} /></label>}
      <button disabled={disabled}>{submitLabel || (manager ? 'Registar aceitação do cliente' : conditions?.acceptLabel || (advance ? 'Aceito as condições. De seguida farei este pagamento.' : 'Li e aceito as condições da consulta.'))}</button>
    </form>
  </details>
}
