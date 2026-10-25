import { useState } from 'react'
import useClosureDraft from './useClosureDraft'
import styles from './ClosureForm.module.css'

export default function ConsultationNoteEditor({ detail, kind, disabled, send, recoverScope }) {
  const scope = `consultation-note:${kind}:${detail.id}`
  const [editing, setEditing] = useState(recoverScope === scope)
  return editing ? <NoteForm key={scope} detail={detail} kind={kind} scope={scope} disabled={disabled} send={send} onConfirmed={() => setEditing(false)} />
    : <button type="button" className="secondary" disabled={disabled} onClick={() => setEditing(true)}>{kind === 'Shared' ? 'Atualizar informação partilhada' : 'Atualizar nota privada'}</button>
}
function NoteForm({ detail, kind, scope, disabled, send, onConfirmed }) {
  const draft = useClosureDraft(detail, { scope, kind: 'ConsultationNote', initialFields: { text: (kind === 'Shared' ? detail.sharedNote : detail.privateNote) || '' } })
  const [error, setError] = useState('')
  if (!draft.fields || !draft.available) return <p role="status">{draft.error || draft.status}</p>
  return <form data-protect-draft onSubmit={async event => {
    event.preventDefault(); setError('')
    try {
      await draft.flush()
      const result = await send({ action: kind === 'Shared' ? 'UpdateSharedReport' : 'UpdatePrivateNote', id: detail.id, version: detail.version,
        ...(kind === 'Shared' ? { sharedNote: draft.fields.text } : { privateNote: draft.fields.text }) }, false, draft.clear)
      if (result) onConfirmed()
    } catch (failure) { setError(failure.message) }
  }}><p role="status">{draft.status}</p>{(error || draft.error) && <p role="alert" className="notice error">{error || draft.error}</p>}
    {draft.conflict && <div className="notice error"><p>A consulta mudou. A tua nota foi conservada.</p><button type="button" className="secondary" disabled={disabled} onClick={draft.acceptCurrentVersion}>Revi a consulta atual; manter a nota</button></div>}
    <fieldset className={styles.fields} disabled={disabled || draft.conflict}><label>{kind === 'Shared' ? 'Informação partilhada' : 'Nota privada'}<textarea aria-label={kind === 'Shared' ? 'Informação partilhada' : 'Nota privada'} maxLength="8000" value={draft.fields.text} onChange={event => draft.change('text', event.target.value)} /></label><button>{kind === 'Shared' ? 'Publicar nova versão' : 'Guardar nota privada'}</button></fieldset>
  </form>
}
