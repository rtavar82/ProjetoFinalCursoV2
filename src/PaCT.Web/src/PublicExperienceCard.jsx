import AppIcon from './AppIcon'
import { publicMoney } from './publicPresentationData'
import styles from './PublicServiceCard.module.css'

export default function PublicExperienceCard({ experience, service, onConditions, onAgenda }) {
  const priceOptions = !experience.isFree && !service?.definedPerEvent && service?.serviceKind === 'Group' ? [...new Set(service.options.map(publicMoney))] : []
  return <article className={styles.card} aria-labelledby={`experience-${experience.key}`}>
    <div className={styles.icon}><AppIcon name={experience.serviceKind === 'Retreat' ? 'leaf' : 'people'} /></div>
    <div className={styles.copy}>
      <h3 id={`experience-${experience.key}`}>{experience.title}</h3>
      {experience.introduction && <p className={styles.introduction}>{experience.introduction}</p>}
      {experience.description && <p>{experience.description}</p>}
      <div className={styles.facts}><span><AppIcon name="clock" />{experience.durationText}</span><span><AppIcon name="people" />Presencial · Vagas limitadas</span></div>
      {experience.isFree ? <p className={styles.introduction}>Participação gratuita</p> : <div className={styles.investment}><span>Investimento</span>{priceOptions.length ? priceOptions.map(price => <p key={price}><strong>{price}</strong></p>) : <p>{experience.priceText}</p>}</div>}
      <button type="button" className={styles.paymentLink} aria-haspopup="dialog" onClick={() => onConditions(experience.key)}>{experience.isFree ? 'Condições de participação' : 'Condições e forma de pagamento'}</button>
      <button type="button" className={`secondary ${styles.agenda}`} onClick={() => onAgenda(service?.id)}>Ver datas e vagas <AppIcon name="arrow" /></button>
    </div>
  </article>
}
