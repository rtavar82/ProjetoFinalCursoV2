import { useState } from 'react'
import ClosureForm from './ClosureForm'
import { FinancialEntryForm } from './FinancePanel'
import styles from './Consultations.module.css'

const outcomes = [['Performed', 'Consulta realizada'], ['NoShow', 'Não compareceu'], ['CancelledManager', 'Cancelada pela gestora']]

export default function ConsultationResolution({ detail, people, disabled, guard, submit, onClose, instant }) {
  const [choice, setChoice] = useState(null)
  return <section className={styles.resolution} aria-label="Tratar consulta">
    {!choice ? <><h3>Como queres tratar esta consulta?</h3><div className={styles.resolutionActions}>
      {detail.actions?.includes('Receipt') && <button type="button" className="secondary" disabled={disabled} onClick={() => setChoice('Receipt')}>Registar recebimento</button>}
      {outcomes.map(([value, label]) => <button key={value} type="button" className="secondary" disabled={disabled} onClick={() => setChoice(value)}>{label}</button>)}
    </div></> : <>
      <button type="button" className="text-button" disabled={disabled} onClick={() => guard(() => setChoice(null))}>Voltar às opções</button>
      {choice === 'Receipt'
        ? <FinancialEntryForm key={'receipt:' + detail.id} people={people} consultation={detail} disabled={disabled} submit={submit} instant={instant} />
        : <ClosureForm key={choice + ':' + detail.id} detail={detail} fixedOutcome={choice} disabled={disabled} onClose={onClose} instant={instant} />}
    </>}
  </section>
}
