import useRecoveryState from './useRecoveryState'
import ClosureForm from './ClosureForm'
import CreditSettlementForm from './CreditSettlementForm'
import { FinancialEntryForm } from './FinancePanel'
import styles from './Consultations.module.css'

const outcomes = [['Performed', 'Consulta realizada'], ['NoShow', 'Não compareceu'], ['CancelledManager', 'Cancelada pela gestora']]

export default function ConsultationResolution({ detail, people, disabled, guard, submit, onClose, instant, act }) {
  const [choice, setChoice] = useRecoveryState('view:resolution:' + detail.id, null)
  return <section className={styles.resolution} aria-label="Tratar consulta">
    {!choice ? <><h3>Como queres tratar esta consulta?</h3><div className={styles.resolutionActions}>
      {detail.actions?.includes('Receipt') && <button type="button" className="secondary" disabled={disabled} onClick={() => setChoice('Receipt')}>Registar recebimento</button>}
      {detail.actions?.includes('Settle') && <button type="button" className="secondary" disabled={disabled || detail.balance <= 0} onClick={() => setChoice('Settle')}>Liquidar com crédito</button>}
      {outcomes.map(([value, label]) => <button key={value} type="button" className="secondary" disabled={disabled} onClick={() => setChoice(value)}>{label}</button>)}
    </div></> : <>
      <button type="button" className="text-button" disabled={disabled} onClick={() => guard(() => setChoice(null))}>Voltar às opções</button>
      {choice === 'Receipt'
        ? <FinancialEntryForm key={'receipt:' + detail.id} people={people} consultation={detail} disabled={disabled} submit={submit} instant={instant} />
        : choice === 'Settle' ? <CreditSettlementForm key={'settle:' + detail.id} record={detail} manager disabled={disabled} act={act} />
          : <ClosureForm key={choice + ':' + detail.id} detail={detail} fixedOutcome={choice} disabled={disabled} onClose={onClose} instant={instant} />}
    </>}
  </section>
}
