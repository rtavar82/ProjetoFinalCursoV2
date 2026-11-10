import { useEffect, useState } from 'react'
import AppIcon from './AppIcon'
import ActionButton from './ActionButton'
import ConsultationDialog from './ConsultationDialog'
import Heading from './Heading'
import PublicPaymentMethods from './PublicPaymentMethods'
import { PublicContributionTerms, PublicPracticalInformation, PublicServiceContact } from './PublicServiceDetails'
import { publicGroupRegistration, publicMode, publicMoney, publicLocations } from './publicPresentationData'
import styles from './PublicPaymentDialog.module.css'

function pricesByModality(options, shortFormat) {
  const prices = new Map()
  for (const option of options) {
    const existing = prices.get(option.modality)
    if (option.referencePrice == null || existing && existing.referencePrice !== option.referencePrice) return ''
    prices.set(option.modality, option)
  }
  return ['InPerson', 'Remote'].filter(modality => prices.has(modality)).map(modality => {
    const option = prices.get(modality)
    const amount = publicMoney(option)
    const mode = publicMode(option)
    return shortFormat ? `${amount.replace(/,00(?=\s*€$)/, '')} ${mode.toLowerCase()}` : `${amount} ${mode}`
  }).join(' · ')
}

export default function PublicPaymentDialog({ service, information, person, onAgenda, onClose }) {
  const [returnFocus] = useState(() => document.activeElement)
  useEffect(() => () => { if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }) }, [returnFocus])
  const policies = new Map()
  for (const option of service.options) {
    const modes = policies.get(option.paymentMode) || new Set()
    modes.add(publicMode(option)); policies.set(option.paymentMode, modes)
  }
  const payable = service.options.some(option => option.paymentMode !== 'Free')
  const advance = policies.has('Prepayment')
  const contributionOnly = !service.serviceKind && policies.size === 1 && policies.has('Contribution')
  const individualPrepayment = !service.serviceKind && policies.size === 1 && advance
  const title = service.title.trim()
  const reikiPrepayment = individualPrepayment && title === 'Sessão de Reiki & Alinhamento Energético'
  const sentir = title.replace(/[“”«»]/g, '"') === 'Consultas "Sentir Além do Olhar"'
  const sentirPrepayment = individualPrepayment && sentir
  const compactDetails = contributionOnly || reikiPrepayment
  const summarizePrices = sentirPrepayment || (reikiPrepayment && !service.packOffer)
  const priceSummary = summarizePrices ? pricesByModality(service.options, reikiPrepayment) : ''
  const duration = [...new Set(service.options.map(option => {
    const minutes = option.durationMinutes
    if (!minutes) return 'Variável'
    const hours = Math.floor(minutes / 60), remainder = minutes % 60
    return [hours && `${hours} h`, remainder && `${remainder} min`].filter(Boolean).join(' ')
  }))].join(' / ')
  const modes = [...new Set(service.options.map(publicMode))]
  const modality = modes.length > 1 ? 'Presencial ou online' : modes[0]
  const prices = [...new Set(service.options.map(option => [publicMode(option), publicMoney(option), option.publicLocation].filter(Boolean).join(' · ')))]
  const locations = publicLocations(service.options.filter(option => option.modality === 'InPerson' && option.locationDescription !== 'Sessões presenciais, mediante marcação.'))
  return <ConsultationDialog title={service.title} label={service.title} onClose={onClose}>
    <div className={styles.content}>
      <section className={styles.policy}><Heading level={3}>Em que consiste</Heading>
        {service.presentation?.description && <p>{service.presentation.description}</p>}
        {service.presentation?.recommendations && <p>{service.presentation.recommendations}</p>}
        {!sentir && service.packOffer && <><p>{service.packOffer.description}</p><p>{service.packOffer.durationText}</p></>}
      </section>
      <ActionButton variant="secondary" className={styles.agendaAction} onClick={onAgenda}>{service.serviceKind ? 'Ver datas e vagas' : 'Ver horários'} <AppIcon name="arrow" /></ActionButton>
      <PublicPracticalInformation duration={duration} modality={modality}>
        {!compactDetails && locations.map(location => <p key={location.key}><strong>{location.name}</strong> · {location.description}</p>)}
      </PublicPracticalInformation>
      <section className={styles.policy}><Heading level={3}>Valor e condições</Heading>
        {contributionOnly ? <PublicContributionTerms information={information} /> : <>
          {priceSummary ? <p><strong>{priceSummary}</strong></p> : prices.map(price => <p key={price}><strong>{price}{service.packOffer ? ' por sessão' : ''}</strong></p>)}
          {advance && <p>{reikiPrepayment
            ? 'Pagamento antecipado. No agendamento, consulta as condições aplicáveis antes de efetuares o pagamento.'
            : 'Pagamento antecipado. Consulta as condições aplicáveis no agendamento antes de efetuares o pagamento.'}</p>}
        </>}
      </section>
      {service.serviceKind === 'Group' && <section className={styles.policy}>
        <Heading level={4}>Inscrição</Heading>
        <p>{publicGroupRegistration}</p>
      </section>}
      {!compactDetails && [...policies].filter(([policy]) => !sentir || policy !== 'Prepayment').map(([policy, modes]) => <section className={policy === 'Prepayment' ? styles.conditions : styles.policy} key={policy}>
        {policies.size > 1 && <p className={styles.modality}>{[...modes].join(' ou ')}</p>}
        {policy === 'Contribution' ? <PublicContributionTerms information={information} /> : policy === 'Free' ? <><h4>Sem pagamento</h4><p>Este serviço é gratuito.</p></> : policy === 'Postpayment' ? <><h4>Pagamento da consulta</h4><p>O pagamento é feito depois da consulta.</p></> : null}
        {policy === 'Prepayment' && <>
          <h4>Condições de pagamento</h4>
          <ul>{information.prepayment.payments.map(text => <li key={text}>{text}</li>)}</ul>
          <h4>Cancelamentos ou faltas</h4>
          <ul>{information.prepayment.cancellations.map(text => <li key={text}>{text}</li>)}</ul>
        </>}
      </section>)}
      {payable && <PublicPaymentMethods information={information} headingLevel={3} inlineCopyNotice advance={advance} mixedModes={policies.size > 1} nonAdvance={[...policies.keys()].some(policy => policy === 'Postpayment' || policy === 'Contribution')} />}
      <PublicServiceContact person={person} note={information.contactNote} />
    </div>
  </ConsultationDialog>
}
