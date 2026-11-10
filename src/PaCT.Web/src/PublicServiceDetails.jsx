import AppIcon from './AppIcon'
import Heading from './Heading'
import styles from './PublicPaymentDialog.module.css'

export function PublicPracticalInformation({ duration, modality, children }) {
  return <section className={styles.policy}>
    <Heading level={3}>Informação prática</Heading>
    <dl className={styles.practical}>
      <div><dt><strong>Duração</strong></dt><dd>{duration}</dd></div>
      <div><dt><strong>Modalidade</strong></dt><dd>{modality}</dd></div>
    </dl>
    {children}
  </section>
}

export function PublicContributionTerms({ information }) {
  return <>
    <Heading level={4}>Contribuição livre e consciente</Heading>
    <p>{information.contributionText}</p>
    <p><strong>{information.contributionTiming}</strong></p>
  </>
}

export function PublicServiceContact({ person, note }) {
  return <footer className={styles.contact}>
    <p>{note}</p>
    <div className={styles.contactActions}>
      {person.whatsapp && <a href={person.whatsapp} target="_blank" rel="noopener noreferrer"><AppIcon name="whatsapp" />Mensagem no WhatsApp</a>}
      {person.telephone && <a href={person.telephone}><AppIcon name="phone" />Ligar à {person.name.trim().split(/\s+/)[0]}</a>}
    </div>
  </footer>
}
