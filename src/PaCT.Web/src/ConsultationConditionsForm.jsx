import { useState } from 'react'
import PublicPaymentMethods from './PublicPaymentMethods'
import styles from './ConsultationConditionsForm.module.css'

export function ConditionsContent({ conditions, terms }) {
  const advance = conditions?.mode === 'Prepayment'
  return <>
    {conditions?.sections ? conditions.sections.map(section => <section key={section.title}>
      <h3>{section.title}</h3>{section.paragraphs.map(text => <p key={text}>{text}</p>)}
      {section.bullets.length > 0 && <ul>{section.bullets.map(text => <li key={text}>{text}</li>)}</ul>}
    </section>) : <p>{terms}</p>}
    {conditions?.paymentInformation && <PublicPaymentMethods information={conditions.paymentInformation} advance={advance} />}
  </>
}

export function ConditionsAcceptanceFields({ conditions, terms, disabled, accepted, onChange, required = false, children }) {
  const advance = conditions?.mode === 'Prepayment'
  return <details className={styles.conditions}>
    <summary>{conditions?.paymentInformation || advance ? 'Ler condições de pagamento' : 'Ler condições da consulta'}</summary>
    <ConditionsContent conditions={conditions} terms={terms} />
    <div className={styles.acceptance}>
      <label className="checkbox"><input type="checkbox" name="accept" checked={accepted} required={required} disabled={disabled} onChange={event => onChange(event.target.checked)} />{conditions?.paymentInformation || advance ? 'Li e aceito as condições e a forma de pagamento apresentada.' : 'Li e aceito as condições da consulta.'}</label>
      {children}
    </div>
  </details>
}

export default function ConsultationConditionsForm({ consultation, disabled, onAccept, submitLabel }) {
  const [acceptedVersion, setAcceptedVersion] = useState(null), [error, setError] = useState('')
  const conditions = consultation.paymentConditions
  const version = conditions?.version || consultation.termsVersion || ''
  const accepted = acceptedVersion !== null && acceptedVersion === version
  const advance = (conditions?.mode || consultation.financialChoice || consultation.paymentMode) === 'Prepayment'
  async function submit(event) {
    event.preventDefault()
    if (disabled) return
    if (!accepted) { setError('Confirma que leste e aceitas as condições apresentadas.'); return }
    setError('')
    await onAccept({ conditionsAccepted: true, termsVersion: conditions?.version || consultation.termsVersion })
  }
  return <ConditionsAcceptanceFields conditions={conditions || { mode: advance ? 'Prepayment' : consultation.paymentMode }} terms={consultation.terms} disabled={disabled} accepted={accepted} onChange={value => { setAcceptedVersion(value ? version : null); if (value) setError('') }}>
    <form data-protect-draft aria-label="Aceitar as condições da consulta" onSubmit={submit}>
      {error && <p role="alert" className="notice error">{error}</p>}
      <button disabled={disabled}>{submitLabel || conditions?.acceptLabel || (advance ? 'Aceito as condições. De seguida farei este pagamento.' : 'Li e aceito as condições da consulta.')}</button>
    </form>
  </ConditionsAcceptanceFields>
}
