import AppIcon from './AppIcon'
import ActionButton from './ActionButton'
import InformationCard from './InformationCard'
import styles from './PublicServiceCard.module.css'

export default function PublicServiceCard({ service, preview, onDetails }) {
  const title = preview?.title ?? service.title
  const introduction = preview?.introduction ?? (service.presentation?.introduction || service.presentation?.description)
  const icon = preview?.icon ?? (service.serviceKind === 'Group' ? 'people' : service.title.includes('Reiki') ? 'heart' : service.serviceKind === 'Retreat' ? 'leaf' : 'user')
  return <InformationCard as="article" className={styles.card} aria-label={title}>
    <div className={styles.icon}><AppIcon name={icon} /></div>
    <h3 data-typography="card-title">{title}</h3>
    <p>{introduction}</p>
    <ActionButton variant="text" className={styles.paymentLink} aria-haspopup="dialog" aria-label={`Ver mais detalhes: ${title}`} onClick={onDetails}>Ver mais detalhes</ActionButton>
  </InformationCard>
}
