import Consultations from './Consultations'
import ClientAgenda from './ClientAgenda'
export default function AgendaPage(props) { return props.manager ? <Consultations {...props} area="Agenda" /> : <ClientAgenda {...props} /> }
