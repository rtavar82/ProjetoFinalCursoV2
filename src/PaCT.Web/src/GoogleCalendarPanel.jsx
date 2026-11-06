import { useState } from 'react'
import ActionButton from './ActionButton'
import InformationCard from './InformationCard'
import { agendaDate } from './agendaTime'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'

const readCalendar = signal => apiRequest('management/google-calendar', undefined, { signal })

export default function GoogleCalendarPanel({ busy, guard }) {
  const calendar = useLiveResource('agenda', 'google-calendar-connection', readCalendar)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState(() => window.location.hash.endsWith('?ligacao=falhou')
    ? 'Não foi possível ligar ao Google Calendar. Verifica a conta e tenta novamente.' : '')

  async function connect() {
    if (connecting) return
    setError(''); setConnecting(true)
    try {
      const result = await apiRequest('management/google-calendar/connect', {})
      const url = new URL(result.url)
      if (url.origin !== 'https://accounts.google.com') throw new Error('Não foi possível abrir a autorização do Google.')
      window.location.assign(url.href)
    } catch (failure) {
      setError(failure.message); setConnecting(false)
    }
  }

  const data = calendar.data
  return <InformationCard cardId="google-calendar-connection" title="Google Calendar"
    loading={calendar.loading} error={calendar.error} onRetry={calendar.refresh}>
    {error && <p className="notice error" role="alert">{error}</p>}
    {data && <>
      <p>{data.connected
        ? data.unavailable ? 'Ligação indisponível. A Agenda mantém os últimos bloqueios conhecidos.' : 'Calendário ligado. Os períodos ocupados bloqueiam a Agenda PaCT.'
        : data.configured ? 'Liga o calendário principal da terapeuta para consultar os períodos ocupados.' : 'Falta configurar a autorização do Google Calendar nesta instalação.'}</p>
      {data.checkedAt && <p>Última verificação: {agendaDate(data.checkedAt)}</p>}
      {data.configured && (!data.connected || data.unavailable) && <ActionButton disabled={busy || connecting} onClick={() => guard(connect)}>
        {connecting ? 'A abrir a autorização…' : data.connected ? 'Voltar a ligar ao Google Calendar' : 'Ligar ao Google Calendar'}
      </ActionButton>}
    </>}
  </InformationCard>
}
