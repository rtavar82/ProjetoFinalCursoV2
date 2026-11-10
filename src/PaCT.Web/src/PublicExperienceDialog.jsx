import { useEffect, useState } from 'react'
import AppIcon from './AppIcon'
import ActionButton from './ActionButton'
import ConsultationDialog from './ConsultationDialog'
import Heading from './Heading'
import PublicPaymentMethods from './PublicPaymentMethods'
import { PublicContributionTerms, PublicPracticalInformation, PublicServiceContact } from './PublicServiceDetails'
import { publicGroupRegistration, publicMoney } from './publicPresentationData'
import styles from './PublicPaymentDialog.module.css'

export default function PublicExperienceDialog({ experience, service, information, person, onAgenda, onClose }) {
  const [returnFocus] = useState(() => document.activeElement)
  useEffect(() => () => { if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }) }, [returnFocus])
  const constellationGroup = experience.key === 'constelacao-grupo'
  const workshop = experience.key === 'oficina-dons-cura'
  const retreat = experience.key === 'retiro'
  const prices = !constellationGroup && !experience.isFree && !service?.definedPerEvent && service?.serviceKind === 'Group'
    ? [...new Set(service.options.map(publicMoney))] : []
  const conditions = experience.conditions.filter(({ title }) =>
    !(constellationGroup && title === 'Pagamento') && !(workshop && ['Inscrição', 'Cancelamentos ou faltas'].includes(title)))

  function conditionParagraphs({ title, paragraphs }) {
    if (retreat && title === 'Programa e inscrição') return [
      'Consulta na Agenda o programa, as datas, o local, as vagas e as condições do retiro. Não são necessárias inscrições separadas para cada dia ou actividades incluídas.',
      ...paragraphs.slice(1).map(text => text.replace(/^Com conta PaCT,/, 'Com conta registada,')),
    ]
    if (retreat && title === 'Desistência do participante') return [
      'Com conta registada, podes cancelar diretamente antes do início do retiro. Sem conta, contacta diretamente a terapeuta.',
      'Aplicam-se as condições de cancelamento específicas do retiro, que podem prever devolução integral, parcial ou retenção de valores. O cancelamento não movimenta valores automaticamente.',
    ]
    if (retreat && title === 'Cancelamento pela organização') return paragraphs.map(text =>
      text.startsWith('A restituição é tratada expressamente pela gestão') ?
        'A restituição é tratada expressamente pela gestão e pode ser feita em dinheiro ou em saldo de créditos na conta, mediante a tua aprovação.' : text)
    if (constellationGroup && title === 'Inscrição') return [publicGroupRegistration]
    if (workshop && title === 'Participação') return [...paragraphs, publicGroupRegistration]
    return paragraphs
  }
  return <ConsultationDialog title={experience.title} label={experience.title} onClose={onClose}>
    <div className={styles.content}>
      <section className={styles.policy}><Heading level={3}>Em que consiste</Heading><p>{experience.description}</p></section>
      <ActionButton variant="secondary" className={styles.agendaAction} onClick={onAgenda}>Ver datas e vagas <AppIcon name="arrow" /></ActionButton>
      <PublicPracticalInformation duration={experience.serviceKind === 'Group' ? 'Variável' : experience.durationText} modality="Presencial" />
      <section className={styles.policy}><Heading level={3}>Valor e condições</Heading>
        {constellationGroup ? <PublicContributionTerms information={information} /> : <p><strong>{experience.isFree ? 'Gratuita' : prices.join(' · ') || experience.priceText}</strong></p>}
        {experience.isFree && !workshop && <p>Mesmo sem conta PaCT, podes pedir a inscrição na Agenda.</p>}
      </section>
      {conditions.map(section => <section className={styles.policy} key={section.title}><Heading level={4}>{section.title}</Heading>{conditionParagraphs(section).map(text => <p key={text}>{text}</p>)}</section>)}
      {!experience.isFree && <PublicPaymentMethods information={information} headingLevel={3} inlineCopyNotice />}
      <PublicServiceContact person={person} note={information.contactNote} />
    </div>
  </ConsultationDialog>
}
