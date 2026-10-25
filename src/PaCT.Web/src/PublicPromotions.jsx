import { useCallback } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import InformationCard from './InformationCard'
import CardGrid from './CardGrid'
import AppIcon from './AppIcon'
import { agendaDate, agendaMoney } from './agendaTime'
import { readPublicPresentation } from './publicPresentationData'

export default function PublicPromotions({ onAgenda }) {
  const read = useCallback(signal => apiRequest('consultations/promotions', undefined, { signal }), [])
  const resource = useLiveResource('agenda', 'public-promotions', read)
  const presentation = useLiveResource('publicPresentation', 'public-presentation', readPublicPresentation)
  const person = presentation.data?.therapist
  return <section aria-label="Partilhas"><p className="eyebrow">PARTILHAS</p><h1>Encontros e oportunidades.</h1>
    <InformationCard cardId="public-promotions" loading={resource.loading} error={resource.error} onRetry={resource.refresh}>
      {resource.data?.packs.length === 0 && resource.data?.events.length === 0 && <p>Ainda não existem divulgações publicadas.</p>}
      <CardGrid>{resource.data?.packs.map(pack => <InformationCard as="article" key={pack.id} title={pack.title} cardId={'promotion-pack-' + pack.id}><p className="eyebrow">PACK DE CONSULTAS</p><p style={{ whiteSpace: 'pre-wrap' }}>{pack.text}</p><p>Contacta a gestão para combinar as sessões, os serviços e o preço total do pack. Podes continuar a escolher consultas avulso.</p>
        {person ? <><a href={person.whatsapp} target="_blank" rel="noopener noreferrer"><AppIcon name="whatsapp" />Falar com a Denise</a><a href={person.telephone}><AppIcon name="phone" />Ligar à Denise</a></> : <p>{presentation.error || 'A carregar os contactos…'}</p>}
      </InformationCard>)}
      {resource.data?.events.map(event => <InformationCard as="article" key={event.id} title={event.title} cardId={'promotion-event-' + event.id}><p>{agendaDate(event.startsAt)} — {agendaDate(event.endsAt)}</p><p>{event.publicLocation}</p>{event.text && <p style={{ whiteSpace: 'pre-wrap' }}>{event.text}</p>}<p>{event.isFree ? 'Participação gratuita' : event.paymentMode === 'Contribution' ? 'Contribuição livre e consciente' : event.price == null ? 'Valor a combinar' : agendaMoney(event.price)}</p><button type="button" className="text-button" onClick={() => onAgenda(event.serviceId)}><AppIcon name="calendar" />Ver programa e inscrição na Agenda</button></InformationCard>)}
      </CardGrid>
    </InformationCard>
  </section>
}
