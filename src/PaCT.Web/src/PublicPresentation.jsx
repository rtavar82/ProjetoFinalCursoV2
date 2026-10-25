import { useId, useRef, useState } from 'react'
import AppLayout from './AppLayout'
import AppIcon from './AppIcon'
import PublicServiceCard from './PublicServiceCard'
import PublicPaymentDialog from './PublicPaymentDialog'
import PublicExperienceCard from './PublicExperienceCard'
import PublicExperienceDialog from './PublicExperienceDialog'
import HomeTestimonialCard from './HomeTestimonialCard'
import useLiveResource from './useLiveResource'
import { readPublicPresentation, publicMoney } from './publicPresentationData'
import styles from './PublicPresentation.module.css'

function PublicAccordion({ label, title, titleId, className = '', bodyClassName = styles.accordionBody, children }) {
  const detailsRef = useRef(null)
  const bodyId = useId()
  function close() {
    const details = detailsRef.current
    const summary = details.querySelector('summary')
    details.open = false
    summary.focus({ preventScroll: true })
    summary.scrollIntoView({ block: 'center', behavior: 'instant' })
  }
  return <details ref={detailsRef} className={`${styles.accordion} ${className}`}>
    <summary className={styles.companionHeading}><h2><span className="eyebrow">{label}</span><span id={titleId}>{title}</span></h2><AppIcon name="arrow" /></summary>
    <div id={bodyId} className={bodyClassName}>{children}</div>
    <div className={styles.accordionRail}><button type="button" className={styles.floatingClose} aria-label={`Fechar ${label}`} aria-expanded="true" aria-controls={bodyId} onClick={close}><AppIcon name="arrowDown" /></button></div>
  </details>
}

function ContentOnly({ children }) { return children }

export default function PublicPresentation({ page, onNavigate, children, profile, onAccount, embedded = false }) {
  const resource = useLiveResource('publicPresentation', 'public-presentation', readPublicPresentation, !['PublicAgenda', 'PublicTestimonials'].includes(page))
  const [payment, setPayment] = useState(null)
  const [experienceConditions, setExperienceConditions] = useState(null)
  const data = resource.data, person = data?.therapist
  const individual = data?.services.filter(s => !s.serviceKind) || [], activities = data?.services.filter(s => s.serviceKind) || []
  const locations = data?.locations || []
  const paymentService = individual.find(service => service.id === payment)
  const experienceCards = (data?.experiencePresentations || []).map(experience => ({ experience, service: activities.find(service => [experience.title, ...(experience.serviceTitles || [])].some(title => service.title.trim().toLocaleLowerCase('pt-PT') === title.trim().toLocaleLowerCase('pt-PT'))) }))
  const selectedExperience = experienceCards.find(card => card.experience.key === experienceConditions)?.experience
  const otherActivities = activities.filter(service => !experienceCards.some(card => card.service?.id === service.id))
  const Layout = embedded ? ContentOnly : AppLayout
  function showServices(event) {
    event.preventDefault()
    const section = document.getElementById('servicos')
    const accordion = section?.querySelector('details')
    if (accordion) accordion.open = true
    section?.scrollIntoView({ block: 'start' })
    section?.focus({ preventScroll: true })
  }
  return <Layout publicNavigation onHome={() => onNavigate('PublicHome')} navigation={<nav className={styles.navigation} aria-label="Navegação principal"><button type="button" aria-current={['PublicHome', 'PublicTestimonials'].includes(page) ? 'page' : undefined} onClick={() => onNavigate('PublicHome')}><AppIcon name="leaf" />Início</button><button type="button" aria-current={page === 'PublicAgenda' ? 'page' : undefined} onClick={() => onNavigate('PublicAgenda')}><AppIcon name="calendar" />Agenda</button><button type="button" aria-current={page === 'PublicPromotions' ? 'page' : undefined} onClick={() => onNavigate('PublicPromotions')}><AppIcon name="heart" />Partilhas</button></nav>}
    session={profile ? <button type="button" className="secondary" onClick={onAccount}>Voltar à minha área</button> : <><span>Visitante</span><button type="button" className="secondary" onClick={() => onNavigate('SignIn')}>Iniciar sessão</button></>}>
    <div className={`${styles.page} ${page === 'PublicHome' ? styles.homePage : ''}`}>
      {['PublicAgenda', 'PublicTestimonials', 'PublicPromotions'].includes(page) ? children : <>
        {resource.error && <div role="alert" className="notice error"><p>{resource.error}</p><button type="button" className="text-button" onClick={resource.refresh}>Voltar a tentar</button></div>}
        {page === 'PublicHome' ? <>
          <section className={styles.hero}><div><p className="eyebrow">{person ? `${person.name} · Transformação Feminina` : 'Transformação Feminina'}</p><h1>Bem-vinda ao teu espaço de <em>libertação e leveza.</em></h1><p>Quando as mesmas dinâmicas se repetem e o peso do dia a dia se torna demasiado, não tens de olhar para tudo sozinha.</p><div className={styles.actions}><a className={styles.actionLink} href="#servicos" onClick={showServices}>Conhecer os serviços <AppIcon name="arrowDown" /></a><button type="button" className={styles.actionLink} onClick={() => onNavigate('PublicAgenda')}>Ver agenda <AppIcon name="calendar" /></button></div></div><div className={styles.art} aria-hidden="true"><AppIcon name="leaf" /><p>Um tempo para parar.<br />Um espaço para ti.</p></div></section>
          {person && <PublicAccordion label="Quem te acompanha" title={person.name} className={styles.companion} bodyClassName={styles.companionContent}>
            <p>{person.role}</p><div><p>{person.summary}</p><p>{person.approach}</p><button className="secondary" onClick={() => onNavigate('PublicTherapist')}>Conhecer a Terapeuta Denise <AppIcon name="arrow" /></button></div>
          </PublicAccordion>}
          <section id="servicos" tabIndex="-1" className={styles.section} aria-labelledby="public-services"><PublicAccordion label="Como te posso ajudar hoje?" title="Escolhe o teu ponto de partida." titleId="public-services"><p>Sessões individuais, presenciais ou online, para diferentes momentos do teu caminho.</p>
            {resource.loading && <p role="status">A consultar os serviços…</p>}
            {data && !individual.length && <p>Os serviços serão apresentados aqui quando estiverem disponíveis.</p>}
            <div className={styles.services}>{individual.map(service => <PublicServiceCard key={service.id} service={service} onPayment={setPayment} onAgenda={id => onNavigate('PublicAgenda', id)} />)}</div>
          </PublicAccordion></section>
          {data && <section className={styles.experiences} aria-labelledby="public-experiences"><PublicAccordion label="Experiências em grupo" title="Partilhar também faz parte do caminho." titleId="public-experiences"><p>Grupos, oficinas e retiros decorrem em datas próprias, com vagas limitadas.</p>
            {experienceCards.length > 0 && <div className={styles.services}>{experienceCards.map(({ experience, service }) => <PublicExperienceCard key={experience.key} experience={experience} service={service} onConditions={setExperienceConditions} onAgenda={id => onNavigate('PublicAgenda', id)} />)}</div>}
            {otherActivities.length > 0 && <div className={styles.services}>{otherActivities.map(service => <article className={styles.card} key={service.id}><h3>{service.title}</h3>{service.presentation?.description && <p>{service.presentation.description}</p>}{service.options.map(o => <p key={o.id}>{o.publicLocation} · {publicMoney(o)}</p>)}<button className="secondary" onClick={() => onNavigate('PublicAgenda', service.id)}>Ver na agenda</button></article>)}</div>}
            {!experienceCards.length && !activities.length && <><ul>{data.experiences.map(title => <li key={title}>{title}</li>)}</ul><button type="button" className={styles.actionLink} onClick={() => onNavigate('PublicAgenda')}><AppIcon name="calendar" />Consultar a agenda de grupos e retiros</button></>}
          </PublicAccordion></section>}
          <HomeTestimonialCard onNavigate={onNavigate} />
          {data && <section className={styles.section} aria-labelledby="public-locations"><PublicAccordion label="Ao teu encontro" title="Presencial ou à distância." titleId="public-locations"><ul className={styles.locations}>{locations.map(location => <li key={`${location.modality}:${location.name}`}><AppIcon name={location.modality === 'Remote' ? 'video' : 'pin'} /><div><h3>{location.name}</h3><p>{location.description}</p></div></li>)}</ul></PublicAccordion></section>}
        </> : person && <>
          <button type="button" className="text-button" onClick={() => onNavigate('PublicHome')}>← Voltar ao início</button>
          <section className={styles.biography}><div><p className="eyebrow">{person.role}</p><h1>{person.name}</h1><h2>{person.heading}</h2><p>{person.introduction}</p></div><img src={person.heroImage} alt={person.heroAlt} width="640" height="720" /></section>
          {person.sections.map(section => <section className={styles.split} key={section.heading}><h2>{section.heading}</h2><p className={styles.text}>{section.text}</p></section>)}
          <section className={styles.section}><h2>{person.galleryTitle}</h2><div className={styles.gallery}>{person.gallery.map(photo => <figure key={photo.image}><img src={photo.image} alt={photo.alt} loading="lazy" width="600" height="600" /><figcaption>{photo.caption}</figcaption></figure>)}</div></section><p className={styles.text}>{person.closing}</p><img className={styles.signature} src={person.signatureImage} alt="Assinatura de Denise Tavares" loading="lazy" width="240" height="100" />
        </>}
        {person && <><section className={styles.contact} aria-labelledby="public-help"><h2 id="public-help">Não sabes por onde começar?</h2><p>Fala com a Denise para perceber qual o serviço que faz sentido para o teu momento. Os pedidos de consulta aguardam confirmação.</p><div className={styles.contactLinks}><a className={styles.actionLink} href={person.telephone}><AppIcon name="phone" />Falar com a Denise</a><a className={styles.actionLink} href={person.whatsapp} target="_blank" rel="noopener noreferrer"><AppIcon name="whatsapp" />Falar com a Denise no WhatsApp</a><button type="button" className={styles.actionLink} onClick={() => onNavigate('PublicAgenda')}><AppIcon name="calendar" />Consultar a agenda</button></div></section>
          <section className={styles.social} aria-labelledby="public-social"><h2 id="public-social">Acompanha-me também nas redes sociais.</h2><a href={person.instagram} target="_blank" rel="noopener noreferrer"><AppIcon name="instagram" />Instagram<AppIcon name="arrow" /></a></section></>}
      </>}
      {paymentService && <PublicPaymentDialog key={paymentService.id} service={paymentService} information={data.paymentInformation} person={person} onClose={() => setPayment(null)} />}
      {selectedExperience && <PublicExperienceDialog key={selectedExperience.key} experience={selectedExperience} information={data.paymentInformation} person={person} onClose={() => setExperienceConditions(null)} />}
    </div>
  </Layout>
}
