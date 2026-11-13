import moneyText from './moneyText'
import { agendaMoney } from './agendaTime'

export default function EventCardInfo({ event }) {
  if (!event) return null
  return <>
    <p>{moneyText(event.isFree ? 'Gratuito' : event.paymentMode === 'Contribution' ? 'Contribuição livre' : event.price == null ? 'Valor a combinar' : agendaMoney(event.price))}</p>
    <p>{!event.registrationOpen ? 'Inscrições encerradas' : event.remaining > 0 ? `${event.remaining} ${event.remaining === 1 ? 'vaga disponível' : 'vagas disponíveis'}` : 'Inscrições completas'}</p>
  </>
}
