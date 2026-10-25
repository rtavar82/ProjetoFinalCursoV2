import { useCallback, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import useConsultationNames from './useConsultationNames'
import { addDays, agendaDate, agendaMoney, dayKey, instant, shiftMonth } from './agendaTime'
import styles from './ManagerAgenda.module.css'

const tabs = [['Upcoming', 'Consultas que aguardam a data'], ['Pending', 'Pendentes de validação e pagamento'], ['All', 'Todas as marcações']]
const states = { Requested: 'Pedido por validar', InTreatment: 'Em tratamento', Confirmed: 'Confirmada', AwaitingClosure: 'Por fechar', Performed: 'Realizada', NoShow: 'Não compareceu', CancelledClient: 'Cancelada pelo cliente', CancelledManager: 'Cancelada pela gestão', Cancelled: 'Cancelada', Rejected: 'Recusada', Expired: 'Pedido expirado', Scheduled: 'Agendado', Waiting: 'Em espera' }
const descriptions = {
  Upcoming: 'Marcações prontas cuja hora de início ainda não chegou, por ordem de horário. Depois do início, são tratadas em Consultas → Por fechar.',
  Pending: 'Pedidos, validações de pagamento, dívidas e outras situações das consultas que exigem intervenção, mais antigos primeiro.',
  All: 'Todas as marcações e respetivos estados.'
}
const dateText = day => new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'))

function period(mode, anchor) {
  if (mode === 'Month') return { from: anchor.slice(0, 7) + '-01', to: shiftMonth(anchor.slice(0, 7), 1) + '-01' }
  if (mode === 'Day') return { from: anchor, to: addDays(anchor, 1) }
  const weekday = (new Date(anchor + 'T12:00:00Z').getUTCDay() + 6) % 7
  const from = addDays(anchor, -weekday)
  return { from, to: addDays(from, 7) }
}

export default function ManagerAgenda({ enabled, disabled, onSetup, onBooking, onOpen }) {
  const [section, setSection] = useState('Upcoming')
  const [mode, setMode] = useState('Week')
  const [anchor, setAnchor] = useState(() => dayKey(new Date()))
  const [page, setPage] = useState(1)
  const range = period(mode, anchor)
  const query = new URLSearchParams({ section, page })
  if (section === 'Upcoming') { query.set('from', instant(range.from + 'T00:00')); query.set('to', instant(range.to + 'T00:00')) }
  const queryText = query.toString()
  const read = useCallback(async signal => {
    const value = await apiRequest('consultations/management?' + queryText, undefined, { signal })
    if (!Array.isArray(value.items) || !Number.isInteger(value.total) || value.total < 0) throw new Error('Não foi possível ler as marcações. Tenta novamente.')
    return value
  }, [queryText])
  const list = useLiveResource('consultations', 'management:' + queryText, read, enabled)
  const names = useConsultationNames(enabled ? list.data?.items || [] : [], null, true)
  function select(next) { setSection(next); setPage(1) }
  function chooseDate(next) { if (/^\d{4}-\d{2}-\d{2}$/.test(next)) { setAnchor(next); setPage(1) } }
  function move(direction) {
    chooseDate(mode === 'Month' ? shiftMonth(anchor.slice(0, 7), direction) + '-01' : addDays(anchor, direction * (mode === 'Week' ? 7 : 1)))
  }
  const unit = mode === 'Week' ? 'semana' : mode === 'Month' ? 'mês' : 'dia'
  return <div className={styles.page}>
    <section className={styles.card} data-card-id="manager-agenda-actions" aria-labelledby="manager-agenda-title">
      <p className={styles.eyebrow}>Gestão da agenda</p><h1 id="manager-agenda-title">Agenda</h1>
      <p>Define a disponibilidade e gere as marcações dos clientes.</p>
      <div className={styles.actions}>
        <div><button disabled={disabled} onClick={onSetup}>Construir e editar agenda</button><p>Define os horários e períodos disponíveis para marcações.</p></div>
        <div><button disabled={disabled} onClick={onBooking}>Agendamento manual</button><p>Cria diretamente uma marcação para um cliente.</p></div>
      </div>
    </section>
    <section className={styles.card} data-card-id="manager-agenda-bookings" aria-labelledby="manager-bookings-title">
      <header className={styles.heading}><div><p className={styles.eyebrow}>Gestão dos pedidos e marcações</p><h2 id="manager-bookings-title">Gestão das marcações</h2></div><button className="text-button" disabled={disabled || list.loading || list.refreshing} onClick={list.refresh}>Atualizar lista</button></header>
      <p className={styles.description}>{descriptions[section]}</p>
      <nav className={styles.tabs} aria-label="Gestão das marcações">{tabs.map(([key, label]) => <button key={key} className={section === key ? '' : 'secondary'} aria-pressed={section === key} disabled={disabled} onClick={() => select(key)}>{label}</button>)}</nav>
      {section === 'Upcoming' && <section className={styles.period} aria-label="Período das marcações">
        <nav className={styles.periodModes} aria-label="Duração do período">{[['Day', 'Dia'], ['Week', 'Semana'], ['Month', 'Mês']].map(([key, label]) => <button key={key} className="secondary" aria-pressed={mode === key} disabled={disabled} onClick={() => { setMode(key); setPage(1) }}>{label}</button>)}</nav>
        <label>Data {mode === 'Day' ? 'do dia' : 'da ' + (mode === 'Week' ? 'semana' : 'referência do mês')}<input type="date" value={anchor} disabled={disabled} onChange={event => chooseDate(event.target.value)} /></label>
        <div className={styles.periodNavigation}><button className="text-button" disabled={disabled} onClick={() => move(-1)}>‹ {unit === 'mês' ? 'Mês' : unit === 'dia' ? 'Dia' : 'Semana'} anterior</button><button className="text-button" disabled={disabled} onClick={() => chooseDate(dayKey(list.data?.serverTime || new Date()))}>Hoje</button><button className="text-button" disabled={disabled} onClick={() => move(1)}>{unit === 'mês' ? 'Mês' : unit === 'dia' ? 'Dia' : 'Semana'} seguinte ›</button></div>
        <p>{range.from === addDays(range.to, -1) ? dateText(range.from) : dateText(range.from) + ' — ' + dateText(addDays(range.to, -1))} · Hora de Lisboa</p>
      </section>}
      {list.error && <div role="alert" className="notice error"><p>{list.error}</p><button className="secondary" disabled={disabled} onClick={list.refresh}>Voltar a tentar</button></div>}
      {names.error && <div role="alert" className="notice error"><p>Não foi possível consultar os nomes dos clientes.</p><button className="text-button" onClick={names.refresh}>Voltar a consultar os nomes</button></div>}
      <div className={styles.results} aria-busy={list.loading || list.refreshing}>
        {list.loading && <p role="status">A consultar as marcações…</p>}
        {list.refreshing && !list.loading && <p role="status">A atualizar a lista…</p>}
        {list.data?.items.map(row => <article key={row.kind + ':' + row.id} className={styles.booking} data-card-id={'manager-booking-' + row.id}>
          <div><span className={styles.badge}>{states[row.state] || row.state}</span><h3>{row.serviceTitle}</h3>
            {row.personId && <p>{names.data?.[row.personId] || (names.loading ? 'A consultar o nome…' : 'Ficha de cliente')}</p>}
            <p>{row.kind === 'Participation' ? 'Inscrição' : row.kind === 'Event' ? 'Grupo ou retiro' : 'Consulta'} · {agendaDate(row.startsAt)} — {agendaDate(row.endsAt)}</p>
            {row.pendingReasons?.length > 0 && <p className={styles.pending}>{row.pendingReasons.join(' · ')}{row.amountDue != null ? ' · ' + agendaMoney(row.amountDue) : ''}</p>}
            {section === 'Pending' && <p>Recebido: {agendaDate(row.createdAt)}</p>}
            <p className={styles.reference}>Referência: {row.id}</p>
          </div><button className="secondary" disabled={disabled} onClick={() => onOpen(row)}>Abrir e tratar</button>
        </article>)}
        {list.data?.total === 0 && <div className={styles.empty}>{section === 'Upcoming' ? 'Não existem consultas a realizar neste período.' : section === 'Pending' ? 'Não existem situações pendentes.' : 'Não existem marcações nesta lista.'}</div>}
        {list.data?.total > 8 && <nav className={styles.pagination} aria-label="Páginas das marcações"><button className="secondary" disabled={disabled || page === 1} onClick={() => setPage(value => value - 1)}>Anterior</button><span>Página {page}</span><button className="secondary" disabled={disabled || page * 8 >= list.data.total} onClick={() => setPage(value => value + 1)}>Seguinte</button></nav>}
      </div>
    </section>
  </div>
}
