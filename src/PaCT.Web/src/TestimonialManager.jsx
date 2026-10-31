import { useEffect, useRef, useState } from 'react'
import useLiveResource from './useLiveResource'
import useEditorState from './useEditorState'
import { readManagedTestimonials, saveTestimonial } from './testimonialData'
import { TestimonialViewer } from './PublicTestimonials'
import styles from './Testimonials.module.css'

export default function TestimonialManager({ guard, onPublic }) {
  const resource = useLiveResource('testimonials', 'testimonial-management', readManagedTestimonials)
  const [editingId, edit] = useState(null)
  const [newItem, setNew] = useState(null)
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
  const editor = useEditorState({ text: item.text, removeImage: false, operationId: crypto.randomUUID() }, item.version)
  const [imageUrl, setImageUrl] = useState(null)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const pending = useRef(false)
  const form = useRef(null)
  const file = editor.files[0]
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file); let active = true
    queueMicrotask(() => { if (active) setImageUrl(url) })
    return () => { active = false; URL.revokeObjectURL(url) }
  }, [file])
  const currentImage = file ? imageUrl : editor.fields?.removeImage ? null : item.imageUrl
  const savedAlready = confirmed || !!item.operationId && item.operationId === editor.fields?.operationId
  function change(name, value) { editor.change(name, value); editor.change('operationId', crypto.randomUUID()) }
  function cleanUp() { form.current?.reset(); onSaved() }
  async function submit(event) {
    event.preventDefault()
    if (pending.current || savedAlready) return
    pending.current = true; setBusy(true); setError('')
    const publish = event.nativeEvent.submitter?.value === 'publish' || item.published
    try {
      await editor.ready()
      await saveTestimonial(item, editor.fields, file, publish)
      setConfirmed(true); await cleanUp()
    } catch (failure) { setError(failure.message) }
    finally { pending.current = false; setBusy(false) }
  }
  return <form ref={form} className={styles.editor} data-protect-draft data-pending-command={busy || imageBusy || undefined} onSubmit={submit}>
    <h2>{item.version ? 'Editar publicação' : 'Nova publicação'}</h2>
    {error && <p className="notice error" role="alert">{error}</p>}
    {savedAlready && <p className="notice success" role="status">Publicação guardada no servidor.<button type="button" className="secondary" onClick={cleanUp}>Concluir</button></p>}
    {editor.conflict && !savedAlready && <div className="notice error"><p>A publicação mudou. O texto e a imagem em edição foram mantidos.</p><button type="button" className="secondary" onClick={() => { editor.acceptCurrentVersion(); editor.change('operationId', crypto.randomUUID()) }}>Revi a publicação atual; manter o preenchimento</button></div>}
    <fieldset disabled={busy || imageBusy || savedAlready || editor.conflict}>
      <label>Texto<textarea name="text" maxLength="10000" value={editor.fields.text} onChange={event => change('text', event.target.value)} /></label>
      <label>Imagem<input type="file" name="image" accept="image/jpeg,image/png" onChange={async event => {
        const selected = event.target.files[0]; event.target.value = ''; if (!selected || imageBusy) return
        setImageBusy(true)
        try {
          const replacing = editor.files.length > 0
          await editor.addPhotos([selected]); if (replacing) editor.removePhoto(0)
          change('removeImage', false); setError('')
        } catch (failure) { setError(failure.message) }
        finally { setImageBusy(false) }
      }} /></label>
      <p className="field-help">Uma imagem JPEG ou PNG, até 4 MB. Podes usar só texto, só imagem ou ambos.</p>
      {currentImage && <div className={styles.preview}><img src={currentImage} alt="Imagem selecionada para a publicação" /><button type="button" className="secondary" onClick={() => { if (editor.files.length) editor.removePhoto(0); change('removeImage', true) }}>Retirar imagem</button></div>}
      <div className={styles.editorActions}><button type="button" className="secondary" disabled={!editor.fields.text.trim() && !currentImage} onClick={() => setPreview(true)}>Pré-visualizar</button>
        <button type="submit" value="save">{item.published ? 'Guardar alterações' : 'Guardar rascunho'}</button>
        {!item.published && <button type="submit" value="publish">Publicar</button>}
        <button type="button" className="secondary" onClick={onCancel}>Fechar editor</button></div>
    </fieldset>
    {preview && <TestimonialViewer item={{ text: editor.fields.text, imageUrl: currentImage }} onClose={() => setPreview(false)} />}
  </form>
}
