import { useEffect, useRef, useState } from 'react'
import useLiveResource from './useLiveResource'
import useClosureDraft from './useClosureDraft'
import { readManagedTestimonials, saveTestimonial } from './testimonialData'
import { TestimonialViewer } from './PublicTestimonials'
import styles from './Testimonials.module.css'

export default function TestimonialManager({ guard, initialEntry, onPublic }) {
  const resource = useLiveResource('testimonials', 'testimonial-management', readManagedTestimonials)
  const [editingId, edit] = useState(initialEntry?.id || null)
  const [newItem, setNew] = useState(initialEntry?.id ? { id: initialEntry.id, version: 0, text: '', imageUrl: null, published: false } : null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const item = resource.data?.find(row => row.id === editingId) || (newItem?.id === editingId ? newItem : null)
  function create() {
    guard(() => {
      const value = { id: crypto.randomUUID(), version: 0, text: '', imageUrl: null, published: false }
      setNew(value); edit(value.id); setError('')
    })
  }
  async function visibility(row) {
    if (pending.current) return
    await guard(async () => {
      pending.current = true; setBusy(true); setError('')
      try { await saveTestimonial(row, { text: row.text, operationId: crypto.randomUUID(), removeImage: false }, null, !row.published); resource.refresh() }
      catch (failure) { setError(failure.message) }
      finally { pending.current = false; setBusy(false) }
    })
  }
  return <section className={styles.manager} aria-labelledby="testimonial-management-title" data-pending-command={busy || undefined}>
    <h1 id="testimonial-management-title">Testemunhos</h1>
    <div className={styles.editorActions}><button type="button" disabled={busy} onClick={create}>Nova publicação</button><button type="button" className="secondary" disabled={busy} onClick={() => guard(onPublic)}>Ver página pública</button></div>
    {(resource.error || error) && <div className="notice error" role="alert"><p>{error || resource.error}</p>{resource.error && <button type="button" className="secondary" onClick={resource.refresh}>Voltar a tentar</button>}</div>}
    {resource.loading && <p role="status">A consultar as publicações…</p>}
    {item && <TestimonialEditor key={item.id} item={item} onSaved={() => { edit(null); setNew(null); resource.refresh() }} onCancel={() => guard(() => edit(null))} />}
    {resource.data?.length === 0 && <p>Ainda não existem publicações.</p>}
    <div className={styles.list}>{resource.data?.map((row, index) => <article key={row.id} className={styles.row} aria-label={`Publicação ${index + 1}`}>
      <strong>{row.published ? 'Publicada' : 'Não publicada'}</strong>
      {row.imageUrl && <img src={row.imageUrl} alt="Imagem da publicação" loading="lazy" />}
      {row.text && <p>{row.text.length > 160 ? row.text.slice(0, 160) + '…' : row.text}</p>}
      <div className={styles.editorActions}><button type="button" className="secondary" disabled={busy} onClick={() => guard(() => { edit(row.id); setError('') })}>Editar publicação {index + 1}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => visibility(row)}>{row.published ? 'Ocultar' : 'Publicar'} publicação {index + 1}</button></div>
    </article>)}</div>
  </section>
}

function TestimonialEditor({ item, onSaved, onCancel }) {
  const draft = useClosureDraft({ ...item, serviceTitle: 'Testemunho' }, { scope: `testimonial:${item.id}`, kind: 'Testimonial', initialFields: { text: item.text, removeImage: false, operationId: crypto.randomUUID() } })
  const [imageUrl, setImageUrl] = useState(null)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const pending = useRef(false)
  const form = useRef(null)
  const file = draft.files[0]
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file); let active = true
    queueMicrotask(() => { if (active) setImageUrl(url) })
    return () => { active = false; URL.revokeObjectURL(url) }
  }, [file])
  const currentImage = file ? imageUrl : draft.fields?.removeImage ? null : item.imageUrl
  const savedAlready = confirmed || !!item.operationId && item.operationId === draft.fields?.operationId
  function change(name, value) { draft.change(name, value); draft.change('operationId', crypto.randomUUID()) }
  async function cleanUp() {
    try { await draft.clear(); form.current?.reset(); onSaved() }
    catch (failure) { setError('A publicação já foi guardada no servidor. Falta limpar o rascunho deste aparelho: ' + failure.message) }
  }
  async function submit(event) {
    event.preventDefault()
    if (pending.current || savedAlready) return
    pending.current = true; setBusy(true); setError('')
    const publish = event.nativeEvent.submitter?.value === 'publish' || item.published
    try {
      await draft.flush()
      await saveTestimonial(item, draft.fields, file, publish)
      setConfirmed(true); await cleanUp()
    } catch (failure) { setError(failure.message) }
    finally { pending.current = false; setBusy(false) }
  }
  if (!draft.available || !draft.fields) return <p role="status">{draft.error || draft.status}</p>
  return <form ref={form} className={styles.editor} data-protect-draft data-pending-command={busy || imageBusy || undefined} onSubmit={submit}>
    <h2>{item.version ? 'Editar publicação' : 'Nova publicação'}</h2>
    <p role="status">{draft.status}</p>
    {(error || draft.error) && <p className="notice error" role="alert">{error || draft.error}</p>}
    {savedAlready && <p className="notice success" role="status">Publicação guardada no servidor.<button type="button" className="secondary" onClick={cleanUp}>Concluir limpeza do rascunho</button></p>}
    {draft.conflict && !savedAlready && <div className="notice error"><p>A publicação mudou. O texto e a imagem do teu rascunho foram conservados.</p><button type="button" className="secondary" onClick={() => { draft.acceptCurrentVersion(); draft.change('operationId', crypto.randomUUID()) }}>Revi a publicação atual; manter este rascunho</button></div>}
    <fieldset disabled={busy || imageBusy || savedAlready || draft.conflict}>
      <label>Texto<textarea name="text" maxLength="10000" value={draft.fields.text} onChange={event => change('text', event.target.value)} /></label>
      <label>Imagem<input type="file" name="image" accept="image/jpeg,image/png" onChange={async event => {
        const selected = event.target.files[0]; event.target.value = ''; if (!selected || imageBusy) return
        setImageBusy(true)
        try {
          const replacing = draft.files.length > 0
          await draft.addPhotos([selected]); if (replacing) draft.removePhoto(0)
          change('removeImage', false); setError('')
        } catch (failure) { setError(failure.message) }
        finally { setImageBusy(false) }
      }} /></label>
      <p className="field-help">Uma imagem JPEG ou PNG, até 4 MB. Podes usar só texto, só imagem ou ambos.</p>
      {currentImage && <div className={styles.preview}><img src={currentImage} alt="Imagem selecionada para a publicação" /><button type="button" className="secondary" onClick={() => { if (draft.files.length) draft.removePhoto(0); change('removeImage', true) }}>Retirar imagem</button></div>}
      <div className={styles.editorActions}><button type="button" className="secondary" disabled={!draft.fields.text.trim() && !currentImage} onClick={() => setPreview(true)}>Pré-visualizar</button>
        <button type="submit" value="save">{item.published ? 'Guardar alterações' : 'Guardar rascunho'}</button>
        {!item.published && <button type="submit" value="publish">Publicar</button>}
        <button type="button" className="secondary" onClick={onCancel}>Fechar editor</button></div>
    </fieldset>
    {preview && <TestimonialViewer item={{ text: draft.fields.text, imageUrl: currentImage }} onClose={() => setPreview(false)} />}
  </form>
}
