import AppIcon from './AppIcon'
import ActionButton from './ActionButton'
import InformationCard from './InformationCard'
import styles from './PublicServiceCard.module.css'

export default function PublicExperienceCard({ experience, preview, onDetails }) {
  const introduction = preview?.introduction ?? (experience.introduction || experience.description)
  const icon = preview?.icon ?? (experience.serviceKind === 'Retreat' ? 'leaf' : 'people')
  return <InformationCard as="article" className={styles.card} aria-label={experience.title}>
    <div className={styles.icon}><AppIcon name={icon} /></div>
    <h3 data-typography="card-title">{experience.title}</h3>
    <p>{introduction}</p>
    <ActionButton variant="text" className={styles.paymentLink} aria-haspopup="dialog" aria-label={`Ver mais detalhes: ${experience.title}`} onClick={onDetails}>Ver mais detalhes</ActionButton>
  </InformationCard>
}
