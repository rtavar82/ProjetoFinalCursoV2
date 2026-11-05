import { useCallback, useEffect, useState } from 'react'
import ActionButton from './ActionButton'
import InformationCard from './InformationCard'
import ManagerSchedulingDialog from './ManagerSchedulingDialog'
import { apiRequest } from './identityApi'
import { showSuccess } from './actionNotices'
import useLiveResource from './useLiveResource'
import formStyles from './ManagerScheduling.module.css'

export default function SitePresentationPanel({ section, title, guard, busy }) {
  const path = `management/presentation/${section}`
  const read = useCallback(signal => apiRequest(path, undefined, { signal }), [path])
  const resource = useLiveResource('management', path, read)
  const [session, setSession] = useState(null), [opening, setOpening] = useState(false), [error, setError] = useState('')

  async function open() {
    const editor = crypto.randomUUID()
    setOpening(true)
    setError('')
    try {
      await apiRequest('management/presentation/editor', { editor })
      try { setSession({ ...(await read()), editor }) }
      catch (failure) {
        release(editor)
        throw failure
      }
    } catch (failure) { setError(failure.message) }
    finally { setOpening(false) }
  }

  function close() {
    release(session.editor)
    setSession(null)
    resource.refresh()
  }

  return <>
    <InformationCard title={title} cardId="site-presentation" loading={resource.loading}
      error={resource.error || error} onRetry={resource.error ? resource.refresh : undefined}
      actions={<ActionButton disabled={busy || opening || !resource.data || !!resource.error} onClick={() => guard(open)}>Editar</ActionButton>}>
      <p>{section === 'Places' ? 'As descrições são públicas. A morada completa segue as regras de acesso da Agenda e será usada nos novos registos.' : 'Revê as alterações antes de as publicar na apresentação da PaCT.'}</p>
      {resource.data && <p>{resource.data.version ? `Versão publicada ${resource.data.version}` : 'Conteúdo inicial'}</p>}
    </InformationCard>
    {session && <SiteEditor title={title} session={session} path={path} guard={guard} busy={busy} onClose={close} />}
  </>
}

function release(editor) {
  // If the window loses the connection, the reservation still expires at the server.
  if (navigator.onLine) void apiRequest('management/presentation/editor', { editor, release: true }).catch(() => {})
}

function SiteEditor({ title, session, path, guard, busy, onClose }) {
  const { editor, fields, version } = session
  const [draft, setDraft] = useState(() => Object.fromEntries(fields.map(field => [field.key, field.value])))
  const [review, setReview] = useState(null), [sending, setSending] = useState(false), [error, setError] = useState('')
  const disabled = busy || sending
  const dirty = fields.some(field => draft[field.key].trim() !== field.value)

  useEffect(() => {
    let renewing = false
    const timer = window.setInterval(async () => {
      if (!navigator.onLine || renewing) return
      renewing = true
      try { await apiRequest('management/presentation/editor', { editor, renew: true }) }
      catch (failure) { setError(failure.message) }
      finally { renewing = false }
    }, 60000)
    return () => window.clearInterval(timer)
  }, [editor])

  function prepare(event) {
    event.preventDefault()
    setError('')
    setReview(Object.fromEntries(fields.map(field => [field.key, draft[field.key].trim()])))
  }

  async function publish() {
    setSending(true)
    setError('')
    try {
      await apiRequest(`${path}/publish`, { editor, version, values: review })
      showSuccess('Alterações publicadas.')
      onClose()
    } catch (failure) { setError(failure.message) }
    finally { setSending(false) }
  }

  return <ManagerSchedulingDialog title={review ? 'Rever publicação' : title} disabled={disabled} onClose={() => guard(onClose)}>
    {error && <p className="notice error" role="alert">{error}</p>}
    {review ? <>
      <InformationCard title="Alterações a publicar" headingLevel={3}>
        <dl>{fields.filter(field => review[field.key] !== field.value).map(field => <div key={field.key}><dt><strong>{field.label}</strong></dt><dd>{review[field.key]}</dd></div>)}</dl>
      </InformationCard>
      <div className="button-row">
        <ActionButton variant="secondary" disabled={disabled} onClick={() => setReview(null)}>Voltar à edição</ActionButton>
        <ActionButton disabled={disabled} onClick={publish}>Publicar</ActionButton>
      </div>
    </> : <form data-protect-draft onSubmit={prepare}>
      <fieldset className={formStyles.fields} disabled={disabled}>
        {fields.map(field => {
          const Control = field.multiline ? 'textarea' : 'input'
          return <label key={field.key}>{field.label}<Control required maxLength={field.maximum} value={draft[field.key]}
            onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))} /></label>
        })}
        <div className="button-row">
          <ActionButton variant="secondary" onClick={() => guard(onClose)}>Voltar à gestão</ActionButton>
          <ActionButton type="submit" disabled={!dirty}>Rever antes de publicar</ActionButton>
        </div>
      </fieldset>
    </form>}
  </ManagerSchedulingDialog>
}
