import { useCallback, useContext, useState } from 'react'
import RecoveryForm from './RecoveryForm'
import useRecoveryState from './useRecoveryState'
import { ManagerRecoveryContext } from './managerRecoveryContext'
import ActionButton from './ActionButton'
import AdaptiveSelect from './AdaptiveSelect'
import CalendarInput from './CalendarInput'
import Heading from './Heading'
import InformationCard from './InformationCard'
import Pagination from './Pagination'
import { showSuccess } from './actionNotices'
import { agendaDate, instant, localDate } from './agendaTime'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import styles from './ManagerTasksPage.module.css'

const managerRoles = { TechnicalManager: 'Gestor técnico', TherapistManager: 'Gestora-terapeuta' }

export default function ManagerTasksPage({ guard }) {
  const [completed, setCompleted] = useState(false)
  const [page, setPage] = useState(1)
  const recovery = useContext(ManagerRecoveryContext)
  const [reminder, setReminder] = useRecoveryState('task:reminder', false)
  const [unconfirmed, setUnconfirmed] = useRecoveryState('task:pending', null)
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [finished, setFinished] = useState(() => new Set())
  const read = useCallback(() => apiRequest(`management/tasks?completed=${completed}&page=${page}`), [completed, page])
  const tasks = useLiveResource('managerTasks', `${completed}:${page}`, read)

  function toggleHistory() {
    setPage(1)
    setCompleted(value => !value)
    setError('')
  }

  async function create(event) {
    event.preventDefault()
    if (pending) return
    const form = event.currentTarget
    const data = new FormData(form)
    setError('')
    try {
      const command = unconfirmed || {
        operationId: crypto.randomUUID(),
        text: data.get('text'),
        highPriority: data.get('priority') === 'High',
        reminderAt: reminder ? instant(data.get('reminder')) : null,
      }
      setUnconfirmed(command); await recovery?.protectIntent('task:pending', command.operationId)
      setPending('create')
      const result = await apiRequest('management/tasks', command)
      if (result.id !== command.operationId) throw new Error('A gravação da tarefa não foi confirmada.')
      setUnconfirmed(null, false)
      form.reset()
      setReminder(false, false)
      await recovery?.flush()
      setPage(1)
      setCompleted(false)
      showSuccess('Tarefa guardada.')
    } catch (failure) { setError(failure.message); if (failure.status && failure.status < 500) setUnconfirmed(null, false) }
    finally { setPending('') }
  }

  async function finish(id) {
    if (pending) return
    setPending(id)
    setError('')
    try {
      const result = await apiRequest(`management/tasks/${id}/complete`, {})
      if (result.id !== id) throw new Error('A conclusão da tarefa não foi confirmada.')
      setFinished(previous => new Set(previous).add(id))
      showSuccess('Tarefa concluída.')
    } catch (failure) { setError(failure.message) }
    finally { setPending('') }
  }

  const records = tasks.data?.items.filter(item => completed || !finished.has(item.id)) || []
  return <section className={styles.page} aria-labelledby="manager-tasks-title" data-pending-command={pending ? 'true' : undefined}>
    <Heading level={1} id="manager-tasks-title">Tarefas</Heading>
    <p>Notas e lembretes partilhados pela gestão.</p>
    {!completed && <InformationCard title="Nova tarefa">
      <RecoveryForm recoveryKey="manager-task" recoveryExclude={['reminderEnabled']} onSubmit={create} data-protect-draft="manager-task">
        <label>Texto<textarea name="text" maxLength={5000} required disabled={!!pending || !!unconfirmed} /></label>
        <div className={styles.controls}>
          <label>Prioridade<AdaptiveSelect aria-label="Prioridade" name="priority" defaultValue="Normal" disabled={!!pending || !!unconfirmed}>
            <option value="Normal">Normal</option>
            <option value="High">Alta</option>
          </AdaptiveSelect></label>
          <label className={`checkbox ${styles.reminderToggle}`}>
            <input name="hasReminder" type="checkbox" checked={reminder} disabled={!!pending || !!unconfirmed} onChange={event => setReminder(event.target.checked)} />
            <span>Definir lembrete</span>
          </label>
          <ActionButton type="submit" disabled={!!pending}>{unconfirmed ? "Verificar gravação da tarefa" : "Guardar tarefa"}</ActionButton>
        </div>
        {reminder && <label>Data e hora do lembrete<CalendarInput name="reminder" type="datetime-local" required
          min={localDate(new Date())} disabled={!!pending || !!unconfirmed} /></label>}
      </RecoveryForm>
    </InformationCard>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <InformationCard title={completed ? 'Histórico de tarefas' : 'Tarefas por tratar'} loading={tasks.loading} refreshing={tasks.refreshing}
      error={tasks.error} onRetry={tasks.refresh} actions={<ActionButton variant="secondary" disabled={!!pending || !!unconfirmed} onClick={() => guard(toggleHistory)}>
        {completed ? 'Voltar às tarefas' : 'Ver histórico'}
      </ActionButton>}>
      {tasks.data && records.length === 0 && <p>{completed ? 'Ainda não há tarefas concluídas.' : 'Não há tarefas por tratar.'}</p>}
      {records.length > 0 && <ul className={styles.list}>
        {records.map(item => <li className={styles.row} key={item.id}>
          <div>
            <p className={styles.text} id={`task-${item.id}`}>{item.text}</p>
            <p className="field-help">
              {item.highPriority ? 'Prioridade alta' : 'Prioridade normal'}
              {!completed && item.reminderAt && ` · Lembrete ${agendaDate(item.reminderAt)}`}
              {completed && ` · Concluída em ${agendaDate(item.completedAt)}${item.completedByRole ? ` · ${managerRoles[item.completedByRole]}` : ''}`}
            </p>
          </div>
          {!completed && <ActionButton variant="secondary" className={styles.done} aria-describedby={`task-${item.id}`}
            disabled={!!pending || !!unconfirmed} onClick={() => finish(item.id)}>Feito</ActionButton>}
        </li>)}
      </ul>}
      {tasks.data && <Pagination total={tasks.data.total} page={tasks.data.page} pageSize={tasks.data.pageSize}
        onChange={setPage} disabled={!!pending || !!unconfirmed} label="Paginação das tarefas" />}
    </InformationCard>
  </section>
}
