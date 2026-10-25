import { useState } from 'react'
import styles from './PublicPaymentDialog.module.css'

export default function PublicPaymentMethods({ information, advance = false, mixedModes = false, nonAdvance = false }) {
  const [copyNotice, setCopyNotice] = useState('')
  async function copyIban() {
    try { await navigator.clipboard.writeText(information.iban); setCopyNotice('IBAN copiado.') }
    catch { setCopyNotice('Não foi possível copiar automaticamente. Seleciona e copia o IBAN apresentado.') }
  }
  return <section className={styles.methods} aria-label="Como pagar"><h4>Como pagar</h4>
    <h5>Transferência bancária</h5><p>{information.transferNote}</p><p>IBAN: <span className={styles.bankCode}>{information.iban.match(/.{1,4}/g).join(' ')}</span></p><p>BIC/SWIFT: <span className={styles.bankCode}>{information.bic}</span></p>
    <button type="button" className={styles.copyLink} onClick={copyIban}>Copiar IBAN</button>{copyNotice && <p role="status">{copyNotice}</p>}
    <h5>MB WAY</h5><p>Envia o pagamento para {information.mbWay}. {information.mbWayNote}</p>
    <h5>Dinheiro</h5>{mixedModes && advance ? <><p>Com pagamento antecipado: {information.advanceCashNote}</p>{nonAdvance && <p>Sem pagamento antecipado: {information.cashNote}</p>}</> : <p>{advance ? information.advanceCashNote : information.cashNote}</p>}
  </section>
}
