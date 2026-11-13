import DisclosureSummary from './DisclosureSummary'
import AppArrow from './AppArrow'
import { useRef, useState } from 'react'
import ActionButton from './ActionButton'
import AppLayout from './AppLayout'
import AppNavigation from './AppNavigation'
import AppIcon from './AppIcon'
import ConsultationDialog from './ConsultationDialog'
import Heading from './Heading'
import Signature from './Signature'
import BrandButterfly from './BrandButterfly'
import PhotoFrame from './PhotoFrame'
import PublicServiceCard from './PublicServiceCard'
import PublicPaymentDialog from './PublicPaymentDialog'
import PublicExperienceCard from './PublicExperienceCard'
import PublicExperienceDialog from './PublicExperienceDialog'
import HomeTestimonialCard from './HomeTestimonialCard'
import useLiveResource from './useLiveResource'
import { publicCatalogueIntroductions, publicExperiencePreview, publicIndividualPreviews, readPublicPresentation } from './publicPresentationData'
import styles from './PublicPresentation.module.css'

const tabs = [
  ['PublicHome', 'Início', 'home'], ['PublicAgenda', 'Agenda', 'calendar'], ['PublicSharing', 'Partilhas', 'conversations'],
]
const childPages = ['PublicAgenda', 'PublicTestimonials', 'PublicSharing']

function ContentOnly({ children }) { return children }

function TherapistProfile({ person, socialTitle }) {
  return <div className={styles.profile}>
    <div className={styles.biography}>
      <PhotoFrame frameKey="therapist:portrait" className={styles.biographyPhoto} src={person.heroImage} alt={person.heroAlt} width="640" height="720" />
      <div><p className="eyebrow">{person.role}</p><Heading>{person.heading}</Heading><p>{person.introduction}</p></div>
    </div>
    {(person.summary || person.approach) && <section className={styles.profileSection} aria-label="Abordagem">
      {person.summary && <p>{person.summary}</p>}
      {person.approach && <p>{person.approach}</p>}
    </section>}
    {person.sections.map((section, index) => <section className={styles.profileSection} key={index}>
      <Heading level={3}>{section.heading}</Heading><p className={styles.text}>{section.text}</p>
    </section>)}
    {person.gallery.length > 0 && <section className={styles.profileSection}><Heading level={3}>{person.galleryTitle}</Heading>
      <div className={styles.gallery}>{person.gallery.map((photo, index) => <figure key={photo.image}>
        <PhotoFrame frameKey={`therapist:gallery:${index}`} src={photo.image} alt={photo.alt} loading="lazy" width="600" height="600" /><figcaption>{photo.caption}</figcaption>
      </figure>)}</div>
    </section>}
    <div><p className={styles.text}>{person.closing}</p><Signature className={styles.signature} src={person.signatureImage} label={`Assinatura de ${person.name}`} /></div>
    {person.instagram && <section className={styles.profileSection} aria-label="Redes sociais">
      <p>{socialTitle || 'Acompanha-me também nas redes sociais.'}</p>
      <a className={styles.actionLink} href={person.instagram} target="_blank" rel="noopener noreferrer"><AppIcon name="instagram" />Instagram</a>
    </section>}
  </div>
}

function Contact({ person, firstName }) {
  return <section className={styles.contact} aria-labelledby="public-contact">
    <Heading id="public-contact">Fala com a {firstName}</Heading>
    <p>Se tens dúvidas sobre qual o serviço indicado para ti, fala com a {firstName}.</p>
    <div className={styles.contactLinks} data-ui="contact-links">
      {person.telephone && <a className={styles.actionLink} data-typography="contact-link" href={person.telephone}><AppIcon name="phone" />Telefone</a>}
      {person.whatsapp && <a className={styles.actionLink} data-typography="contact-link" href={person.whatsapp} target="_blank" rel="noopener noreferrer"><AppIcon name="whatsapp" />WhatsApp</a>}
      {person.instagram && <a className={styles.actionLink} data-typography="contact-link" href={person.instagram} target="_blank" rel="noopener noreferrer"><AppIcon name="instagram" />Instagram</a>}
    </div>
  </section>
}

export default function PublicPresentation({ page, onNavigate, children, profile, onAccount, embedded = false }) {
  const resource = useLiveResource('publicPresentation', 'public-presentation', readPublicPresentation, !childPages.includes(page))
  const [selected, setSelected] = useState(null)
  const therapistTrigger = useRef(null)
  const data = resource.data, person = data?.therapist, home = data?.home
  const individual = data?.services.filter(s => !s.serviceKind && s.options.length > 0) || []
  const activities = data?.services.filter(s => s.serviceKind) || []
  const firstName = person?.name.trim().split(/\s+/)[0]
  const experienceCards = (data?.experiencePresentations || []).map(experience => ({ experience,
    service: activities.find(service => [experience.title, ...(experience.serviceTitles || [])].some(title => service.title.trim().toLocaleLowerCase('pt-PT') === title.trim().toLocaleLowerCase('pt-PT'))) }))
  const otherActivities = activities.filter(service => !experienceCards.some(card => card.service?.id === service.id))
  const selectedService = data?.services.find(service => service.id === selected?.serviceId)
  const selectedExperience = experienceCards.find(card => card.experience.key === selected?.experienceKey)
  const Layout = embedded ? ContentOnly : AppLayout
  const isHome = page === 'PublicHome'
  const individualCards = publicIndividualPreviews(individual)
  const introductions = publicCatalogueIntroductions(home)
  function agenda(id) {
    setSelected(null)
    onNavigate('PublicAgenda', id)
  }
  const useDefaultTitle = !home?.heroTitle || home.heroTitle === 'Bem-vinda ao teu espaço de' && home.heroEmphasis === 'libertação e leveza.'
  const useDefaultIntro = !home?.heroIntroduction || home.heroIntroduction === 'Quando as mesmas dinâmicas se repetem e o peso do dia a dia se torna demasiado, não tens de olhar para tudo sozinha.'
  return <Layout page={page} publicNavigation
    onHome={() => onNavigate('PublicHome')} navigation={<AppNavigation publicNavigation onNavigate={onNavigate} items={tabs.map(([id, label, icon]) => ({
      id, label, icon, active: id === page || id === 'PublicHome' && ['PublicTherapist', 'PublicTestimonials'].includes(page),
    }))} />}
    session={profile ? <ActionButton variant="secondary" onClick={onAccount}>Voltar à minha área</ActionButton> : <ActionButton variant="text" onClick={() => onNavigate('SignIn')}>Iniciar sessão</ActionButton>}>
    <div className={`${styles.page} ${isHome ? styles.home : ''}`}>
      {childPages.includes(page) ? children : <>
        {resource.error && <div role="alert" className="notice error"><p>{resource.error}</p><ActionButton variant="text" onClick={resource.refresh}>Voltar a tentar</ActionButton></div>}
        {isHome ? <>
          <section className={styles.hero}>
            <div className={styles.heroContent}>
              <div className={styles.heroCopy}>
                <p className="eyebrow">Transformação Feminina</p>
                <Heading level={1} appearance="hero-title">{useDefaultTitle ? <>Acompanhamento <em>ao teu ritmo</em></> : <>{home.heroTitle} <em>{home.heroEmphasis}</em></>}</Heading>
                <p className={styles.text}>{useDefaultIntro ? 'Sessões de Constelação Familiar, Reiki e Desenvolvimento Pessoal, com opções presenciais e online.' : home.heroIntroduction}</p>
              </div>
              {person && <div className={styles.introduction}>
                <PhotoFrame frameKey="therapist:portrait" className={styles.introductionPhoto} src={person.heroImage} alt="" width="640" height="720" />
                <ActionButton ref={therapistTrigger} variant="text" className={styles.actionLink} aria-haspopup="dialog" onClick={() => setSelected({ therapist: true })}>Conhecer a {person.name}</ActionButton>
              </div>}
              <details className={styles.catalogue}>
                <DisclosureSummary><span>Ver serviços</span></DisclosureSummary>
                <div className={styles.catalogueContent}>
                  {resource.loading && <p role="status">A consultar os serviços…</p>}
                  {data && !individual.length && !experienceCards.length && !activities.length && !data.experiences.length && <p>Os serviços serão apresentados aqui quando estiverem disponíveis.</p>}
                  {individual.length > 0 && <section aria-label="Sessões individuais">
                    <Heading>Sessões individuais</Heading>
                    {introductions.individual && <p>{introductions.individual}</p>}
                    <div className={styles.services}>{individualCards.map(({ service, preview }) => <PublicServiceCard key={service.id} service={service} preview={preview} onDetails={() => setSelected({ serviceId: service.id })} />)}</div>
                  </section>}
                  {data && <section aria-label="Grupos, oficinas e retiros">
                    <Heading>Grupos, oficinas e retiros</Heading>
                    {introductions.experiences && <p>{introductions.experiences}</p>}
                    <div className={styles.services}>
                      {experienceCards.map(({ experience }) => <PublicExperienceCard key={experience.key} experience={experience} preview={publicExperiencePreview(experience)} onDetails={() => setSelected({ experienceKey: experience.key })} />)}
                      {otherActivities.map(service => <PublicServiceCard key={service.id} service={service} onDetails={() => setSelected({ serviceId: service.id })} />)}
                    </div>
                    {!experienceCards.length && !activities.length && <><ul>{data.experiences.map(title => <li key={title}>{title}</li>)}</ul>
                      <ActionButton variant="text" className={styles.actionLink} onClick={() => agenda()}>Consultar a agenda de grupos e retiros</ActionButton></>}
                  </section>}
                </div>
              </details>
            </div>
          </section>
          <div className={styles.support}>
            <HomeTestimonialCard onNavigate={onNavigate} />
            <section className={styles.places} aria-labelledby="public-locations">
              <Heading id="public-locations">Onde acontece</Heading>
              <p>As sessões online são por videochamada, via WhatsApp ou Google Meet. O local das sessões presenciais é indicado na <ActionButton variant="text" className={styles.inlineLink} onClick={() => agenda()}>Agenda</ActionButton>.</p>
              <p><strong>Vila Nova de São Bento:</strong> Disponibilidade limitada a dias específicos. Consulta a agenda e filtra por este local.</p>
            </section>
            {person && <Contact person={person} firstName={firstName} />}
          </div>
        </> : person && <div className={styles.standalone}>
          <ActionButton variant="text" className={styles.actionLink} onClick={() => onNavigate('PublicHome')}><AppArrow direction="left" /> Voltar ao início</ActionButton>
          <Heading level={1}>{person.name}</Heading>
          <TherapistProfile person={person} socialTitle={home?.socialTitle} />
        </div>}
      </>}
      {selected?.therapist && person && <ConsultationDialog title={<span className={styles.profileTitle}><BrandButterfly className={styles.profileMark} />{person.name}</span>}
        label={person.name} className={styles.profileDialog} onClose={() => { setSelected(null); requestAnimationFrame(() => therapistTrigger.current?.focus({ preventScroll: true })) }}>
        <TherapistProfile person={person} socialTitle={home?.socialTitle} />
      </ConsultationDialog>}
      {selectedExperience && data && <PublicExperienceDialog experience={selectedExperience.experience} service={selectedExperience.service} information={data.paymentInformation}
        person={person} onAgenda={() => agenda(selectedExperience.service?.id)} onClose={() => setSelected(null)} />}
      {selectedService && data && <PublicPaymentDialog service={selectedService} information={data.paymentInformation}
        person={person} onAgenda={() => agenda(selectedService.id)} onClose={() => setSelected(null)} />}
    </div>
  </Layout>
}
