import AppIcon from './AppIcon'
import { publicLocations, publicMode, publicMoney } from './publicPresentationData'
import styles from './PublicServiceCard.module.css'

const duration = minutes => `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h` : ''}${minutes % 60 ? `${Math.floor(minutes / 60) ? ' ' : ''}${minutes % 60}min` : ''}`

export default function PublicServiceCard({ service, onPayment, onAgenda }) {
  const facts = [...new Map(service.options.map(option => [option.durationMinutes, duration(option.durationMinutes)])).values()].join(' / ')
  const modes = [...new Set(service.options.map(publicMode))].join(' ou ')
  const prices = new Map()
  const valueOf = option => `${publicMoney(option)}${service.packOffer ? ' por sessão' : ''}`
  const modePrices = new Map()
  for (const option of service.options) {
    const values = modePrices.get(option.modality) || new Set()
    values.add(valueOf(option)); modePrices.set(option.modality, values)
  }
  for (const option of service.options) {
    const value = valueOf(option)
    const entry = prices.get(value) || new Set()
    entry.add(`${publicMode(option)}${modePrices.get(option.modality).size > 1 && option.publicLocation ? ` · ${option.publicLocation}` : ''}`); prices.set(value, entry)
  }
  const locations = publicLocations(service.options.filter(option => option.modality === 'InPerson' && option.publicLocation.trim() === 'Vila Nova de São Bento'))
  const icon = service.packOffer ? 'user' : service.title === 'Sessão de Reiki & Alinhamento Energético' ? 'heart' : 'leaf'
  return <article className={styles.card} aria-labelledby={`service-${service.id}`}>
    <div className={styles.icon}><AppIcon name={icon} /></div>
    <div className={styles.copy}>
      <h3 id={`service-${service.id}`}>{service.title}</h3>
      {service.presentation?.introduction && <p className={styles.introduction}>{service.presentation.introduction}</p>}
      {service.presentation?.description && <p>{service.presentation.description}</p>}
      <div className={styles.facts}><span><AppIcon name="clock" />{facts} por sessão</span><span><AppIcon name="video" />{modes}</span></div>
      {service.packOffer && <p>{service.packOffer.description}</p>}
      <div className={styles.investment}><span>Investimento</span>{[...prices].map(([value, modalities]) => <p key={value}>{[...modalities].join(' ou ')}: <strong>{value}</strong></p>)}</div>
      {service.packOffer && <p>{service.packOffer.durationText}</p>}
      {service.presentation?.recommendations && <p className={styles.recommendations}>{service.presentation.recommendations}</p>}
      <button type="button" className={styles.paymentLink} aria-haspopup="dialog" onClick={() => onPayment(service.id)}>Forma de pagamento</button>
      {locations.length > 0 && <ul className={styles.locations}>{locations.map(location => <li key={location.key}><AppIcon name={location.icon} /><div><strong>{location.name}</strong><p>{location.description}</p></div></li>)}</ul>}
      <button type="button" className={`secondary ${styles.agenda}`} onClick={() => onAgenda(service.id)}>Ver horários <AppIcon name="arrow" /></button>
    </div>
  </article>
}
