import { useEffect, useState } from 'react'
import AppIcon from './AppIcon'
import ConsultationDialog from './ConsultationDialog'
import PublicPaymentMethods from './PublicPaymentMethods'
import styles from './PublicPaymentDialog.module.css'

export default function PublicExperienceDialog({ experience, information, person, onClose }) {
  const [returnFocus] = useState(() => document.activeElement)
  useEffect(() => () => { if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }) }, [returnFocus])
  const label = experience.isFree ? 'Condições de participação' : 'Condições e forma de pagamento'
  return <ConsultationDialog compact label={label} onClose={onClose}>
    <div className={styles.content}>
      <header className={styles.heading}><h2>{label}</h2></header><h3>{experience.title}</h3>
      {experience.conditions.map(section => <section className={styles.policy} key={section.title}><h4>{section.title}</h4>{section.paragraphs.map(text => <p key={text}>{text}</p>)}</section>)}
      {!experience.isFree && <PublicPaymentMethods information={information} />}
      <footer className={styles.contact}><p>{information.contactNote}</p><a href={person.whatsapp} target="_blank" rel="noopener noreferrer"><AppIcon name="whatsapp" />Mensagem no WhatsApp</a><a href={person.telephone}><AppIcon name="phone" />Ligar à Denise</a></footer>
    </div>
  </ConsultationDialog>
}
