import { useState } from 'react'
import ActionButton from './ActionButton'
import InformationCard from './InformationCard'
import { agendaDate } from './agendaTime'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'

const readCalendar = signal => apiRequest('management/google-calendar', undefined, { signal })

const connectionErrors = new Map([
  ['sessao', 'A tentativa de ligação expirou ou perdeu a sessão. Volta a ligar ao Google Calendar no mesmo navegador.'],
  ['permissao', 'O Google não autorizou o acesso. Confirma a permissão para consultar os horários livres e ocupados.'],
  ['configuracao', 'O Google recusou a configuração da ligação. Confirma o cliente OAuth e o endereço autorizado no Google Cloud.'],
  ['autorizacao', 'O Google não entregou a autorização necessária para manter a ligação. Volta a ligar e confirma a permissão de disponibilidade.'],
  ['renovacao', 'A PaCT recebeu a autorização, mas o Google não conseguiu renová-la. Volta a ligar a conta.'],
  ['pedido-calendario', 'O Google Calendar rejeitou o pedido de consulta dos horários (HTTP 400).'],
  ['periodo-calendario', 'O Google Calendar rejeitou as datas enviadas pela PaCT (HTTP 400).'],
  ['id-calendario', 'O Google Calendar rejeitou a referência ao calendário principal (HTTP 400).'],
  ['calendario', 'A autorização chegou à PaCT, mas falhou a consulta dos horários no Google Calendar. Confirma a permissão e se a Calendar API está ativa.'],
  ['guardar', 'A PaCT consultou o calendário, mas não conseguiu guardar a ligação nesta instalação.'],
])

export default function GoogleCalendarPanel({ busy, guard }) {
  const calendar = useLiveResource('agenda', 'google-calendar-connection', readCalendar)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState(() => {
    const failure = new URLSearchParams(window.location.hash.split('?')[1]).get('ligacao')
    return failure ? connectionErrors.get(failure) ?? 'Não foi possível concluir a autorização do Google Calendar. Volta a tentar.' : ''
  })

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
        ? data.unavailable ? 'Ligação indisponível. A Agenda mantém os últimos bloqueios conhecidos.' : data.familyIncluded
          ? 'Os períodos ocupados do calendário principal e de Família bloqueiam a Agenda PaCT.'
          : 'Os períodos ocupados do calendário principal bloqueiam a Agenda PaCT.'
        : data.configured ? 'Liga a conta Google para consultar os períodos ocupados e publicar marcações no calendário PaCT.' : 'Falta configurar a autorização do Google Calendar nesta instalação.'}</p>
      {data.checkedAt && <p>Última verificação: {agendaDate(data.checkedAt)}</p>}
      {data.connected && data.needsReconnect && <p>Volta a ligar a conta para incluir Família e publicar marcações no calendário PaCT.</p>}
      {data.connected && !data.needsReconnect && <>
        {!data.familyIncluded && <p>A conta ligada ainda não disponibiliza um calendário Família identificável. Confirma a conta usada na ligação.</p>}
        {data.publicationUnavailable ? <p className="notice">Não foi possível atualizar o calendário PaCT no Google. A aplicação volta a tentar automaticamente.</p>
          : data.publishedAt ? <p>Última atualização do calendário PaCT no Google: {agendaDate(data.publishedAt)}</p>
            : <p>A aguardar a primeira atualização do calendário PaCT no Google.</p>}
      </>}
      {data.configured && (!data.connected || data.unavailable || !data.familyIncluded || data.publicationUnavailable || data.needsReconnect) && <ActionButton disabled={busy || connecting} onClick={() => guard(connect)}>
        {connecting ? 'A abrir a autorização…' : data.connected ? 'Voltar a ligar ao Google Calendar' : 'Ligar ao Google Calendar'}
      </ActionButton>}
    </>}
  </InformationCard>
}
