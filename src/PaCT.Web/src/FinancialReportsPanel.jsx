import moneyText from './moneyText'
import DisclosureSummary from './DisclosureSummary'
import { useCallback, useState } from 'react'
import ActionButton from './ActionButton'
import AdaptiveSelect from './AdaptiveSelect'
import CalendarInput from './CalendarInput'
import CardGrid from './CardGrid'
import ClientSearch from './ClientSearch'
import DateRangeFields from './DateRangeFields'
import InformationCard from './InformationCard'
import { addDays, agendaDate, agendaMoney, dayKey, setDateRangeParams, shiftMonth } from './agendaTime'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import SectionTabs from './SectionTabs'
import layout from './FinancialLayout.module.css'

const periods = { Day: 'Dia', Week: 'Semana', Month: 'Mês', Year: 'Ano', Custom: 'Personalizado' }

function bounds(period, day) {
  if (period === 'Week') {
    const weekday = new Date(day + 'T12:00:00Z').getUTCDay()
    const start = addDays(day, -((weekday + 6) % 7))
    return [start, addDays(start, 6)]
  }
  if (period === 'Month') return [day.slice(0, 7) + '-01', addDays(shiftMonth(day.slice(0, 7), 1) + '-01', -1)]
  if (period === 'Year') return [day.slice(0, 4) + '-01-01', day.slice(0, 4) + '-12-31']
  return [day, day]
}

function periodQuery(start, end, filters = {}) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value))
  setDateRangeParams(params, start, end)
  return params.toString()
}

const dateLabel = day => day ? day.split('-').reverse().join('/') : ''

export default function FinancialReportsPanel({ disabled, origins, movementKinds, presentation = 'default' }) {
  const workspace = presentation === 'workspace'
  const [day, setDay] = useState(() => dayKey(new Date()))
  const [mode, setMode] = useState('Month')
  const [custom, setCustom] = useState(() => {
    const [start, end] = bounds('Month', day)
    return { start, end }
  })
  const [client, setClient] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [selection, setSelection] = useState(() => {
    const [start, end] = bounds('Month', day)
    return { start, end, query: periodQuery(start, end) }
  })
  const [start, end] = mode === 'Custom' ? [custom.start, custom.end] : day ? bounds(mode, day) : ['', '']
  const read = useCallback(signal => apiRequest('consultations/reports?' + selection.query, undefined, { signal }), [selection.query])
  const resource = useLiveResource('finance', 'report:' + selection.query, read)
  const report = resource.data
  async function download() {
    setExporting(true)
    setExportError('')
    try {
      const file = await apiRequest('consultations/reports?' + selection.query + '&format=xlsx', undefined, { responseType: 'blob' })
      if (file.type !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') throw new Error('O servidor não devolveu um ficheiro Excel.')
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = 'PaCT-relatorio-financeiro.xlsx'
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setExportError(error.message) }
    finally { setExporting(false) }
  }
  return <section className={workspace ? layout.page : undefined} aria-label="Relatórios financeiros">
    <InformationCard cardId="finance-report-filters" title="Relatórios financeiros">
      <form onSubmit={event => {
        event.preventDefault()
        if (!start || !end || start > end) return
        setExportError('')
        const values = new FormData(event.currentTarget)
        const query = periodQuery(start, end, { personId: client?.id, origin: values.get('origin'), kind: values.get('kind') })
        if (query === selection.query) resource.refresh()
        else setSelection({ start, end, query })
      }}>
        {workspace ? <SectionTabs label="Período do relatório" columns={5} variant="tools" compactMobile value={mode} disabled={disabled} items={Object.entries(periods).map(([id, label]) => ({ id, label }))} onChange={setMode} /> : (<nav className="consultation-tabs" aria-label="Período do relatório">{Object.entries(periods).map(([id, label]) =>
          <ActionButton key={id} variant={mode === id ? 'primary' : 'secondary'} aria-pressed={mode === id} disabled={disabled}
            onClick={() => setMode(id)}>{label}</ActionButton>)}</nav>)}
        {mode === 'Custom' ? <div className="fields-grid">
          <DateRangeFields type="date" startLabel="Desde" endLabel="Até" value={custom} onChange={range => setCustom(range)} required />
        </div> : <>
          <label>{mode === 'Day' ? 'Dia' : 'Data de referência'}<CalendarInput type="date" value={day} required disabled={disabled}
            onChange={event => setDay(event.target.value)} /></label>
          {day && <p>{dateLabel(start)}{start !== end && ' — ' + dateLabel(end)}</p>}
        </>}
        <details><DisclosureSummary>Filtrar por cliente ou movimento</DisclosureSummary>
          <ClientSearch purpose="filter" selected={client} onSelect={setClient} disabled={disabled} />
          <div className="fields-grid">
            <label>Origem dos movimentos<AdaptiveSelect name="origin" disabled={disabled}><option value="">Todas</option>{Object.entries(origins).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</AdaptiveSelect></label>
            <label>Tipo de movimento<AdaptiveSelect name="kind" disabled={disabled}><option value="">Todos</option>{Object.entries(movementKinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</AdaptiveSelect></label>
          </div>
        </details>
        <ActionButton type="submit" disabled={disabled || exporting || !start || !end || start > end}>Apurar relatório</ActionButton>
      </form>
    </InformationCard>
    {(resource.loading || resource.error) && <InformationCard cardId="finance-report-status" loading={resource.loading} error={resource.error} onRetry={resource.refresh} />}
    {report && <>
      <InformationCard cardId="finance-report-period" title="Período apurado" error={exportError}
        actions={<ActionButton variant="text" disabled={disabled || !!resource.error || exporting} onClick={download}>
          {exporting ? 'A preparar Excel…' : 'Exportar para Excel'}
        </ActionButton>}>
        <p><strong>{dateLabel(selection.start)}{selection.start !== selection.end && ' — ' + dateLabel(selection.end)}</strong></p>
        <p>Apuramento {agendaDate(report.asOf)}</p>
        {report.notes?.map(note => <p key={note}>{note}</p>)}
      </InformationCard>
      <CardGrid layout={workspace ? 'appointments' : undefined}>{report.sections?.map(section => <InformationCard key={section.title} title={section.title} headingLevel={3}>
        <dl className={workspace ? layout.reportValues : undefined}>{section.rows.map((row, index) => <div key={index}><dt>{row.label}</dt>
          <dd><strong>{moneyText(row.unit === 'EUR' ? agendaMoney(row.value) : `${row.value} ${row.unit}`)}</strong></dd></div>)}</dl>
      </InformationCard>)}</CardGrid>
    </>}
  </section>
}
