import AdaptiveSelect from './AdaptiveSelect'
import { useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import InformationCard from './InformationCard'
import { addDays, agendaDate, instant } from './agendaTime'
import styles from './AgendaPublication.module.css'

const empty = () => ({ start: '', end: '', wholeDays: false, rows: [] })
function publicationPayload(draft, revision) {
  const startsAt = instant(draft.start), endsAt = instant(draft.end)
  if (endsAt <= startsAt) throw new Error('O fim do período tem de ser posterior ao início.')
  if (draft.rows.length > 512) throw new Error('Publica até 512 intervalos de cada vez.')
  const windows = draft.rows.map(row => ({ startsAt: instant(row.start), endsAt: instant(row.end), available: row.available }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  for (let index = 0; index < windows.length; index++) {
    const window = windows[index]
    if (window.endsAt <= window.startsAt || Date.parse(window.endsAt) - Date.parse(window.startsAt) > 86400000) throw new Error('Cada intervalo tem de ter duração positiva até 24 horas.')
    if (index && windows[index - 1].endsAt > window.startsAt) throw new Error('Os intervalos não podem sobrepor-se.')
  }
  if (!revision) throw new Error('Aguarda a leitura da agenda antes de rever a publicação.')
  return { startsAt, endsAt, revision, windows, replaceWholeDays: draft.wholeDays, confirmConflicts: false }
}
export default function AgendaPublication({ setup, disabled, publish, refresh }) {
  const [draft, setDraft] = useState(empty)
  const [baseline, setBaseline] = useState(null)
  const [review, setReview] = useState(null)
  const [reviewing, setReviewing] = useState(false)
  const [error, setError] = useState('')
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [confirmConflicts, setConfirmConflicts] = useState(false)
  const [pattern, setPattern] = useState({ start: '', end: '', weekdays: [1, 2, 3, 4, 5], available: true })
  const version = useRef(0)
  const form = useRef(null)
  const revision = baseline ?? setup.revision
  const stale = baseline !== null && baseline !== setup.revision
  function changed(next) {
    version.current++
    setBaseline(previous => previous ?? setup.revision)
    setDraft(next); setReview(null); setConfirmConflicts(false); setConfirmEmpty(false); setError('')
  }
  function rowChanged(id, patch) { changed({ ...draft, rows: draft.rows.map(row => row.id === id ? { ...row, ...patch } : row) }) }
  function addPattern() {
    try {
      if (!draft.start || !draft.end || !pattern.start || !pattern.end || !pattern.weekdays.length) throw new Error('Preenche o período, as horas e os dias da semana.')
      const first = draft.start.slice(0, 10), last = draft.end.slice(0, 10)
      const rows = []
      for (let day = first; day <= last; day = addDays(day, 1)) {
        if (rows.length + draft.rows.length > 512) throw new Error('Publica até 512 intervalos de cada vez.')
        if (!pattern.weekdays.includes(new Date(day + 'T12:00:00Z').getUTCDay())) continue
        const start = day + 'T' + pattern.start
        const end = (pattern.end <= pattern.start ? addDays(day, 1) : day) + 'T' + pattern.end
        if (instant(start) < instant(draft.start) || instant(end) > instant(draft.end)) continue
        rows.push({ id: crypto.randomUUID(), start, end, available: pattern.available })
      }
      if (!rows.length) throw new Error('Não há dias completos com estas horas dentro do período escolhido.')
      changed({ ...draft, rows: [...draft.rows, ...rows] })
    } catch (failure) { setError(failure.message) }
  }
  async function preview(event) {
    event.preventDefault()
    if (reviewing || disabled) return
    const editingVersion = version.current
    setReviewing(true); setError(''); setReview(null)
    try {
      const publication = publicationPayload(draft, revision)
      const result = await apiRequest('consultations/availability/preview', publication)
      if (version.current === editingVersion) { setReview({ publication, result, editingVersion }); setConfirmConflicts(false); setConfirmEmpty(false) }
    } catch (failure) { setError(failure.message); if (failure.status === 409) refresh() }
    finally { setReviewing(false) }
  }
  async function confirm() {
    if (!review || stale || disabled || (review.result.conflicts.length && !confirmConflicts) || (!review.publication.windows.length && !confirmEmpty)) return
    const snapshot = review
    const result = await publish({ action: 'PublishAvailability', publication: { ...snapshot.publication, confirmConflicts } }, () => {
      if (version.current === snapshot.editingVersion) form.current?.reset()
    })
    if (!result) { setReview(null); refresh() }
  }
  function reset() {
    version.current++; setDraft(empty()); setBaseline(null); setReview(null); setConfirmEmpty(false); setConfirmConflicts(false); setError('')
  }
  return <InformationCard title="Publicar horários" cardId="agenda-publication" className={styles.card}>
    <p>Escolhe o período e revê os horários antes de publicar. As marcações existentes mantêm-se.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {stale && <div className="notice" role="status"><p>A agenda mudou. O teu preenchimento foi mantido. Revê a agenda atual antes de continuar.</p><button type="button" className="secondary" disabled={disabled} onClick={() => { setBaseline(setup.revision); setReview(null); version.current++ }}>Revi a agenda atual</button></div>}
    <form ref={form} data-protect-draft onSubmit={preview} onReset={reset}>
      <fieldset disabled={disabled} className={styles.fields}>
        <div className={styles.range}>
          <label>Início do período (Lisboa)<input name="publicationStart" type="datetime-local" required value={draft.start} onChange={e => changed({ ...draft, start: e.target.value })} /></label>
          <label>Fim do período, exclusivo (Lisboa)<input name="publicationEnd" type="datetime-local" required value={draft.end} onChange={e => changed({ ...draft, end: e.target.value })} /></label>
        </div>
        <label className="checkbox"><input name="wholeDays" type="checkbox" checked={draft.wholeDays} onChange={e => changed({ ...draft, wholeDays: e.target.checked })} />Substituir os dias completos deste período</label>
        <p className="field-help">Sem esta opção, os horários fora do período escolhido são conservados. A revisão mostra os limites exatos.</p>
        <details className={styles.pattern}><summary>Repetir horários por dias da semana</summary>
          <div className={styles.weekdays}>{[[1, 'Segunda'], [2, 'Terça'], [3, 'Quarta'], [4, 'Quinta'], [5, 'Sexta'], [6, 'Sábado'], [0, 'Domingo']].map(([day, label]) => <label className="checkbox" key={day}><input type="checkbox" checked={pattern.weekdays.includes(day)} onChange={e => setPattern({ ...pattern, weekdays: e.target.checked ? [...pattern.weekdays, day] : pattern.weekdays.filter(x => x !== day) })} />{label}</label>)}</div>
          <div className={styles.range}><label>Hora inicial a repetir<input type="time" value={pattern.start} onChange={e => setPattern({ ...pattern, start: e.target.value })} /></label><label>Hora final a repetir<input type="time" value={pattern.end} onChange={e => setPattern({ ...pattern, end: e.target.value })} /></label></div>
          <label>Estado a repetir<AdaptiveSelect value={String(pattern.available)} onChange={e => setPattern({ ...pattern, available: e.target.value === 'true' })}><option value="true">Disponível</option><option value="false">Bloqueado</option></AdaptiveSelect></label>
          <p className="field-help">Uma hora final igual ou anterior à inicial termina no dia seguinte. Só são adicionados intervalos inteiramente contidos no período.</p>
          <button type="button" className="secondary" onClick={addPattern}>Adicionar horários aos dias selecionados</button>
        </details>
        <h3>Horários a publicar</h3>
        {draft.rows.map((row, index) => <fieldset key={row.id} className={styles.row}><legend>Intervalo {index + 1}</legend>
          <div className={styles.range}><label>Início do intervalo {index + 1}<input type="datetime-local" required value={row.start} onChange={e => rowChanged(row.id, { start: e.target.value })} /></label><label>Fim do intervalo {index + 1}<input type="datetime-local" required value={row.end} onChange={e => rowChanged(row.id, { end: e.target.value })} /></label></div>
          <label>Estado do intervalo {index + 1}<AdaptiveSelect value={String(row.available)} onChange={e => rowChanged(row.id, { available: e.target.value === 'true' })}><option value="true">Disponível</option><option value="false">Bloqueado</option></AdaptiveSelect></label>
          <button type="button" className="secondary" onClick={() => changed({ ...draft, rows: draft.rows.filter(x => x.id !== row.id) })}>Retirar intervalo {index + 1}</button>
        </fieldset>)}
        <button type="button" className="secondary" disabled={draft.rows.length >= 512} onClick={() => changed({ ...draft, rows: [...draft.rows, { id: crypto.randomUUID(), start: '', end: '', available: true }] })}>Adicionar intervalo</button>
        {!draft.rows.length && <p className="notice">Sem intervalos novos, esta publicação retira os horários publicados apenas no período escolhido.</p>}
        <button disabled={reviewing || stale}>{reviewing ? 'A rever os horários…' : 'Rever publicação'}</button>
      </fieldset>
    </form>
    {review && !stale && <section className={styles.review} aria-label="Revisão da publicação">
      <h3>Confirma os horários</h3>
      <p>{agendaDate(review.result.startsAt)} — {agendaDate(review.result.endsAt)} (fim exclusivo)</p>
      <p>{review.publication.windows.length} novos intervalos · {review.result.replacedWindows} intervalos substituídos · {review.result.preservedParts} partes exteriores conservadas</p>
      <ul>{review.publication.windows.map(window => <li key={window.startsAt}>{agendaDate(window.startsAt)} — {agendaDate(window.endsAt)} · {window.available ? 'Disponível' : 'Bloqueado'}</li>)}</ul>
      {review.result.conflicts.length > 0 && <><h4>Marcações a manter</h4><ul>{review.result.conflicts.map(item => <li key={item.id}>{agendaDate(item.startsAt)} — {agendaDate(item.endsAt)} · {item.process.processLabel}</li>)}</ul><label className="checkbox"><input type="checkbox" checked={confirmConflicts} disabled={disabled} onChange={e => setConfirmConflicts(e.target.checked)} />Revi os horários e confirmo que estas marcações se mantêm.</label></>}
      {!review.publication.windows.length && <label className="checkbox"><input type="checkbox" checked={confirmEmpty} disabled={disabled} onChange={e => setConfirmEmpty(e.target.checked)} />Confirmo a retirada dos horários publicados neste período.</label>}
      <button type="button" disabled={disabled || (!!review.result.conflicts.length && !confirmConflicts) || (!review.publication.windows.length && !confirmEmpty)} onClick={confirm}>Publicar horários revistos</button>
    </section>}
  </InformationCard>
}
