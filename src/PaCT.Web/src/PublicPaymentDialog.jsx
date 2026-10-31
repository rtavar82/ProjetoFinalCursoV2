import { useEffect, useState } from 'react'
import AppIcon from './AppIcon'
import ConsultationDialog from './ConsultationDialog'
import PublicPaymentMethods from './PublicPaymentMethods'
import { publicMode } from './publicPresentationData'
import styles from './PublicPaymentDialog.module.css'

export default function PublicPaymentDialog({ service, information, person, onClose }) {
  const [returnFocus] = useState(() => document.activeElement)
  useEffect(() => () => { if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }) }, [returnFocus])
  const policies = new Map()
  for (const option of service.options) {
    const modes = policies.get(option.paymentMode) || new Set()
    modes.add(publicMode(option)); policies.set(option.paymentMode, modes)
  }
  const payable = service.options.some(option => option.paymentMode !== 'Free')
  const advance = policies.has('Prepayment')
  return <ConsultationDialog compact label="Forma de pagamento" onClose={onClose}>
    <div className={styles.content}>
      <header className={styles.heading}><h2>Forma de pagamento</h2></header><h3>{service.title}</h3>
      {[...policies].map(([policy, modes]) => <section className={policy === 'Prepayment' ? styles.conditions : styles.policy} key={policy}>
        {policies.size > 1 && <p className={styles.modality}>{[...modes].join(' ou ')}</p>}
        {policy === 'Contribution' ? <><h4>Contribuição livre e consciente</h4><p>{information.contributionText}</p><p><strong>{information.contributionTiming}</strong></p></> : policy === 'Free' ? <><h4>Sem pagamento</h4><p>Este serviço é gratuito.</p></> : policy === 'Postpayment' ? <><h4>Pagamento da consulta</h4><p>O pagamento é feito depois da consulta.</p></> : null}
        {policy === 'Prepayment' && <><h4>Condições de pagamento</h4><ul>{information.prepayment.payments.map(text => <li key={text}>{text}</li>)}</ul><h4>Cancelamentos ou faltas</h4><ul>{information.prepayment.cancellations.map(text => <li key={text}>{text}</li>)}</ul></>}
      </section>)}
      {payable && <PublicPaymentMethods information={information} advance={advance} mixedModes={policies.size > 1} nonAdvance={[...policies.keys()].some(policy => policy === 'Postpayment' || policy === 'Contribution')} />}
      <footer className={styles.contact}><p>{information.contactNote}</p><a href={person.whatsapp} target="_blank" rel="noopener noreferrer"><AppIcon name="whatsapp" />Mensagem no WhatsApp</a><a href={person.telephone}><AppIcon name="phone" />Ligar à Denise</a></footer>
    </div>
  </ConsultationDialog>
}
