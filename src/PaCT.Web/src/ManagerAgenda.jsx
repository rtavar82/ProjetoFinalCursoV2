import moneyText from './moneyText'
import AgendaPresentation from './AgendaPresentation'
import ActionButton from './ActionButton'
import CardGrid from './CardGrid'
import SectionTabs from './SectionTabs'
import DisclosureSummary from './DisclosureSummary'
import AppArrow from './AppArrow'
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
  Upcoming: <>Marcações prontas cuja hora de início ainda não chegou, por ordem de horário. Depois do início, são tratadas em Consultas <AppArrow direction="right" /> Por fechar.</>,
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
  return <AgendaPresentation title="Agenda" description="Define a disponibilidade e gere as marcações dos clientes." eyebrow={null} headingId="manager-agenda-title" contentClassName={styles.page}>
    <InformationCard variant="plain" className={styles.tools} cardId="manager-agenda-actions" aria-labelledby="manager-agenda-title">
      <div className={styles.actions}>
        <ActionButton disabled={disabled} onClick={onSetup}>Construir e editar agenda</ActionButton>
        <ActionButton variant="tinted" disabled={disabled} onClick={onBooking}>Agendamento manual</ActionButton>
      </div>
      <div className={styles.views}>
        <ActionButton variant="text" disabled={disabled} onClick={onVisitorView}>Ver agenda como visitante</ActionButton>
        <ActionButton variant="text" disabled={disabled} onClick={onGoogleView}>Ver agenda Google</ActionButton>
      </div>
    </InformationCard>
    <InformationCard variant="plain" className={styles.card} cardId="manager-agenda-bookings" aria-labelledby="manager-bookings-title">
      <header className={styles.heading}><h2 id="manager-bookings-title">Gestão das marcações</h2><ActionButton variant="text" disabled={disabled || list.loading || list.refreshing} onClick={list.refresh}>Atualizar lista</ActionButton></header>
      <SectionTabs label="Gestão das marcações" value={section} disabled={disabled} onChange={select}
        items={tabs.map(([id, label, count]) => ({ id, label,
          count: list.loading ? '…' : !list.error && Number.isInteger(list.data?.counts?.[count]) ? list.data.counts[count] : '—',
          countLabel: 'Total de marcações', countTitle: 'Total de marcações, independentemente do período e da página' }))} />
      <p className={styles.description}>{descriptions[section]}</p>
      {section === 'Upcoming' && <section className={styles.period} aria-label="Período das marcações">
        <nav className={styles.periodModes} aria-label="Duração do período">{[['Day', 'Dia'], ['Week', 'Semana'], ['Month', 'Mês']].map(([key, label]) => <button key={key} className="secondary" aria-pressed={mode === key} disabled={disabled} onClick={() => { setMode(key); setPage(1) }}>{label}</button>)}</nav>
        <nav className={styles.periodNavigation} aria-label="Navegar no período">
          <ActionButton variant="secondary" disabled={disabled} aria-label={mode === 'Month' ? '30 dias anteriores' : `${unit === 'dia' ? 'Dia' : 'Semana'} anterior`} onClick={() => move(-1)}><AppArrow direction="left" /></ActionButton>
          <ActionButton variant="secondary" disabled={disabled} onClick={() => chooseDate(dayKey(list.data?.serverTime || new Date()))}>Hoje</ActionButton>
          <ActionButton variant="secondary" disabled={disabled} aria-label={mode === 'Month' ? '30 dias seguintes' : `${unit === 'dia' ? 'Dia' : 'Semana'} seguinte`} onClick={() => move(1)}><AppArrow direction="right" /></ActionButton>
        </nav>
        <details className={styles.periodDetails}><DisclosureSummary>{mode === 'Month' ? 'Ajustar período de 30 dias' : 'Ajustar período'}</DisclosureSummary>
          <label>{mode === 'Day' ? 'Data do dia' : 'Data inicial'}<CalendarInput type="date" value={anchor} disabled={disabled} onChange={event => chooseDate(event.target.value)} /></label>
        </details>
      </section>}
      {section === 'Upcoming' && <p className={styles.range}>{range.from === addDays(range.to, -1) ? dateText(range.from) : dateText(range.from) + ' — ' + dateText(addDays(range.to, -1))} · Hora de Lisboa</p>}
      {list.error && <div role="alert" className="notice error"><p>{list.error}</p><button className="secondary" disabled={disabled} onClick={list.refresh}>Voltar a tentar</button></div>}
      {names.error && <div role="alert" className="notice error"><p>Não foi possível consultar os nomes dos clientes.</p><button className="text-button" onClick={names.refresh}>Voltar a consultar os nomes</button></div>}
      <div className={styles.results} aria-busy={list.loading || list.refreshing}>
        {list.loading && <p role="status">A consultar as marcações…</p>}
        {list.refreshing && !list.loading && <p role="status">A atualizar a lista…</p>}
        <CardGrid layout="appointments">{list.data?.items.map(row => <AppointmentCard key={row.kind + ':' + row.id} consultation={row} cardId={'manager-booking-' + row.id}
          stateLabel={row.process.processLabel} typeLabel={row.kind === 'Consultation' ? 'Consulta individual' : row.kind === 'Guest' ? 'Pedido sem conta' : row.kind === 'Event' ? row.event?.kind === 'Retreat' ? 'Retiro' : 'Grupo' : 'Participação'}
          clientName={row.personId ? names.data?.[row.personId] || (names.loading ? 'A consultar o nome…' : 'Ficha de cliente') : null}
          actionLabel="Abrir e tratar" actionVariant="tinted" disabled={disabled} onOpen={() => onOpen(row)}>
            <EventCardInfo event={row.event} />
            {row.pendingReasons?.length > 0 && section !== 'Conditions' && <p className={styles.pending}>{row.pendingReasons.join(' · ')}{moneyText(row.amountDue != null ? ' · ' + agendaMoney(row.amountDue) : '')}</p>}
            {section !== 'Upcoming' && <p>Recebido: {agendaDate(row.createdAt)}</p>}
            <p className={styles.reference}>Referência: {row.id}</p>
        </AppointmentCard>)}</CardGrid>
        {list.data?.total === 0 && <div className={styles.empty}>{section === 'Upcoming' ? 'Não existem consultas a realizar neste período.' : section === 'Validation' ? 'Não existem pedidos por validar.' : section === 'Conditions' ? 'Não existem condições por aceitar.' : 'Não existem pagamentos pendentes.'}</div>}
        <Pagination total={list.data?.total} page={page} label="Páginas das marcações" disabled={disabled} onChange={setPage} />
      </div>
    </InformationCard>
  </AgendaPresentation>
}
