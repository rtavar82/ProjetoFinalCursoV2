import { useState } from 'react'
import Heading from './Heading'
import MbWayLogo from './MbWayLogo'
import styles from './PublicPaymentDialog.module.css'

export default function PublicPaymentMethods({ information, advance = false, mixedModes = false, nonAdvance = false, heading = true, headingLevel = 4, inlineCopyNotice = false }) {
  const [copyNotice, setCopyNotice] = useState('')
  async function copyIban() {
    try { await navigator.clipboard.writeText(information.iban); setCopyNotice('IBAN copiado.') }
    catch { setCopyNotice('Não foi possível copiar automaticamente. Seleciona e copia o IBAN apresentado.') }
  }
  const copyButton = <button type="button" className={styles.copyLink} onClick={copyIban}>Copiar IBAN</button>
  return <section className={styles.methods} aria-label="Forma de pagamento">{heading && <Heading level={headingLevel}>Forma de pagamento</Heading>}
    {information.iban && <>
      <Heading level={headingLevel + 1}>Transferência bancária</Heading>
      <p>{information.transferNote}</p>
      <div className={styles.bankDetails}>
        <p>IBAN: <span className={styles.bankCode}>{information.iban.match(/.{1,4}/g).join(' ')}</span></p>
        {information.bic && <p>BIC/SWIFT: <span className={styles.bankCode}>{information.bic}</span></p>}
        {inlineCopyNotice ? <div className={styles.copyAction}>
          {copyButton}
          <p className={styles.copyNotice} role="status">{copyNotice}</p>
        </div> : copyButton}
      </div>
      {!inlineCopyNotice && copyNotice && <p role="status">{copyNotice}</p>}
    </>}
    {information.mbWay && <><Heading level={headingLevel + 1}><MbWayLogo /></Heading><p>Envia o pagamento para {information.mbWay}. {information.mbWayNote}</p></>}
    <Heading level={headingLevel + 1}>Dinheiro</Heading>{mixedModes && advance ? <><p>Com pagamento antecipado: {information.advanceCashNote}</p>{nonAdvance && <p>Sem pagamento antecipado: {information.cashNote}</p>}</> : <p>{advance ? information.advanceCashNote : information.cashNote}</p>}
  </section>
}
