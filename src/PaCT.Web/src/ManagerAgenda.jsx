import CalendarInput from './CalendarInput'
import { useCallback, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import useConsultationNames from './useConsultationNames'
import AppointmentCard from './AppointmentCard'
import EventCardInfo from './EventCardInfo'
import InformationCard from './InformationCard'
import Pagination from './Pagination'
import { addDays, agendaDate, agendaMoney, dayKey, instant, rollingPeriod } from './agendaTime'
import styles from './ManagerAgenda.module.css'

const tabs = [['Upcoming', 'Consultas que aguardam a data', 'upcoming'], ['Validation', 'Pendentes de validação', 'validation'], ['Conditions', 'Condições por aceitar', 'conditions'], ['Payments', 'Pendentes de pagamento', 'payments']]
const descriptions = {
  Upcoming: 'Marcações prontas cuja hora de início ainda não chegou, por ordem de horário. Depois do início, são tratadas em Consultas → Por fechar.',
  Validation: 'Pedidos de consulta e inscrições que precisas de aprovar ou recusar, mais antigos primeiro.',
  Conditions: 'Marcações aprovadas que aguardam a aceitação das condições pelo cliente.',
  Payments: 'Pagamentos, recebimentos e dívidas por tratar, incluindo consultas realizadas, mais antigos primeiro.'
}
const dateText = day => new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'))

export default function ManagerAgenda({ enabled, disabled, onSetup, onBooking, onOpen, onVisitorView, onGoogleView }) {
  const [section, setSection] = useState('Upcoming')
  const [mode, setMode] = useState('Week')
  const [anchor, setAnchor] = useState(() => dayKey(new Date()))
  const [page, setPage] = useState(1)
  const range = rollingPeriod(mode, anchor)
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
    chooseDate(rollingPeriod(mode, anchor, direction).from)
  }
  const unit = mode === 'Week' ? 'semana' : mode === 'Month' ? 'mês' : 'dia'
  return <div className={styles.page}>
    <InformationCard className={styles.card} cardId="manager-agenda-actions" aria-labelledby="manager-agenda-title">
      <p className={styles.eyebrow}>Gestão da agenda</p><h1 id="manager-agenda-title">Agenda</h1>
      <p>Define a disponibilidade e gere as marcações dos clientes.</p>
      <div className={styles.actions}>
        <div><button disabled={disabled} onClick={onSetup}>Construir e editar agenda</button><p>Define os horários e períodos disponíveis para marcações.</p></div>
        <div><button disabled={disabled} onClick={onBooking}>Agendamento manual</button><p>Cria diretamente uma marcação para um cliente.</p></div>
      </div>
      <div className={styles.views}>
        <button type="button" className="secondary" disabled={disabled} onClick={onVisitorView}>Ver agenda como visitante</button>
        <button type="button" className="secondary" disabled={disabled} onClick={onGoogleView}>Ver agenda Google</button>
      </div>
    </InformationCard>
    <InformationCard className={styles.card} cardId="manager-agenda-bookings" aria-labelledby="manager-bookings-title">
      <header className={styles.heading}><div><p className={styles.eyebrow}>Gestão dos pedidos e marcações</p><h2 id="manager-bookings-title">Gestão das marcações</h2></div><button className="text-button" disabled={disabled || list.loading || list.refreshing} onClick={list.refresh}>Atualizar lista</button></header>
      <p className={styles.description}>{descriptions[section]}</p>
      <nav className={styles.tabs} aria-label="Gestão das marcações">{tabs.map(([key, label, count]) => <button key={key} className={section === key ? '' : 'secondary'} aria-label={label} aria-pressed={section === key} disabled={disabled} onClick={() => select(key)}>{label}<span className={styles.count} aria-label="Total de marcações" title="Total de marcações, independentemente do período e da página">{list.loading ? '…' : !list.error && Number.isInteger(list.data?.counts?.[count]) ? list.data.counts[count] : '—'}</span></button>)}</nav>
      {section === 'Upcoming' && <section className={styles.period} aria-label="Período das marcações">
        <nav className={styles.periodModes} aria-label="Duração do período">{[['Day', 'Dia'], ['Week', 'Semana'], ['Month', 'Mês']].map(([key, label]) => <button key={key} className="secondary" aria-pressed={mode === key} disabled={disabled} onClick={() => { setMode(key); setPage(1) }}>{label}</button>)}</nav>
        <details className={styles.periodDetails}><summary>{mode === 'Month' ? 'Ajustar período de 30 dias' : 'Ajustar período'}</summary>
          <label>{mode === 'Day' ? 'Data do dia' : 'Data inicial'}<CalendarInput type="date" value={anchor} disabled={disabled} onChange={event => chooseDate(event.target.value)} /></label>
          <div className={styles.periodNavigation}><button className="text-button" disabled={disabled} onClick={() => move(-1)}>{mode === 'Month' ? '‹ 30 dias anteriores' : `‹ ${unit === 'dia' ? 'Dia' : 'Semana'} anterior`}</button><button className="text-button" disabled={disabled} onClick={() => chooseDate(dayKey(list.data?.serverTime || new Date()))}>Hoje</button><button className="text-button" disabled={disabled} onClick={() => move(1)}>{mode === 'Month' ? '30 dias seguintes ›' : `${unit === 'dia' ? 'Dia' : 'Semana'} seguinte ›`}</button></div>
          <p>{range.from === addDays(range.to, -1) ? dateText(range.from) : dateText(range.from) + ' — ' + dateText(addDays(range.to, -1))} · Hora de Lisboa</p>
        </details>
      </section>}
      {list.error && <div role="alert" className="notice error"><p>{list.error}</p><button className="secondary" disabled={disabled} onClick={list.refresh}>Voltar a tentar</button></div>}
      {names.error && <div role="alert" className="notice error"><p>Não foi possível consultar os nomes dos clientes.</p><button className="text-button" onClick={names.refresh}>Voltar a consultar os nomes</button></div>}
      <div className={styles.results} aria-busy={list.loading || list.refreshing}>
        {list.loading && <p role="status">A consultar as marcações…</p>}
        {list.refreshing && !list.loading && <p role="status">A atualizar a lista…</p>}
        {list.data?.items.map(row => <AppointmentCard key={row.kind + ':' + row.id} consultation={row} cardId={'manager-booking-' + row.id}
          stateLabel={row.process.processLabel} typeLabel={row.kind === 'Consultation' ? 'Consulta individual' : row.kind === 'Guest' ? 'Pedido sem conta' : row.kind === 'Event' ? row.event?.kind === 'Retreat' ? 'Retiro' : 'Grupo' : 'Participação'}
          clientName={row.personId ? names.data?.[row.personId] || (names.loading ? 'A consultar o nome…' : 'Ficha de cliente') : null}
          actionLabel="Abrir e tratar" disabled={disabled} onOpen={() => onOpen(row)}>
            <EventCardInfo event={row.event} />
            {row.pendingReasons?.length > 0 && section !== 'Conditions' && <p className={styles.pending}>{row.pendingReasons.join(' · ')}{row.amountDue != null ? ' · ' + agendaMoney(row.amountDue) : ''}</p>}
            {section !== 'Upcoming' && <p>Recebido: {agendaDate(row.createdAt)}</p>}
            <p className={styles.reference}>Referência: {row.id}</p>
        </AppointmentCard>)}
        {list.data?.total === 0 && <div className={styles.empty}>{section === 'Upcoming' ? 'Não existem consultas a realizar neste período.' : section === 'Validation' ? 'Não existem pedidos por validar.' : section === 'Conditions' ? 'Não existem condições por aceitar.' : 'Não existem pagamentos pendentes.'}</div>}
        <Pagination total={list.data?.total} page={page} label="Páginas das marcações" disabled={disabled} onChange={setPage} />
      </div>
    </InformationCard>
  </div>
}
