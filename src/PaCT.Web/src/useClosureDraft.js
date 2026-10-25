import { useEffect, useRef, useState } from 'react'
import { usePrivateVault, registerDraftWriter } from './privateDraftContext'

export default function useClosureDraft(detail, { scope: customScope, kind = 'Closure', resourceId = detail.id, initialFields } = {}) {
  const session = usePrivateVault()
  const [state, setState] = useState({ fields: null, files: [], status: 'A desbloquear rascunho…', error: '' })
  const [comparison, setComparison] = useState(null)
  const scope = customScope || 'closure:' + detail.id
  const initial = useRef(detail)
  const initialValues = useRef(initialFields)
  const writer = useRef({ revision: 0, latest: null, job: null, baseVersion: detail.version })
  const photosInProgress = useRef(null)
  useEffect(() => {
    if (!session?.vault) return
    let active = true
    session.vault.read(scope).then(draft => {
      if (!active) return
      const source = initial.current
      const fields = draft?.fields || initialValues.current || { outcome: 'Performed', method: source.paymentMode === 'Free' ? 'Free' : source.financialChoice === 'Gift' ? 'Gift' : 'Unpaid', start: '', end: '', amount: String(source.referencePrice ?? ''), shared: '', private: '', availability: '', photoIds: [], packId: '' }
      writer.current = { revision: draft?.revision || 0, latest: null, fields, files: draft?.files || [], job: null, baseVersion: draft?.baseVersion ?? source.version }
      setState({ fields, files: draft?.files || [],
        status: draft ? 'Rascunho recuperado deste aparelho.' : 'As alterações serão guardadas cifradas neste aparelho.', error: '' })
    }).catch(error => { if (active) setState(previous => ({ ...previous, error: error.message })) })
    return () => { active = false }
  }, [session?.vault, scope])

  function persist() {
    const current = writer.current
    if (current.job) return current.job
    if (!current.latest || !session?.vault) return Promise.resolve()
    current.job = (async () => {
      while (current.latest) {
        const snapshot = current.latest; current.latest = null
        try {
          current.revision = await session.vault.save(scope, { kind, resourceId, title: detail.serviceTitle,
            baseVersion: current.baseVersion, fields: snapshot.fields }, snapshot.files, current.revision)
          if (!current.latest) setState(previous => ({ ...previous, status: 'Rascunho guardado cifrado neste aparelho.', error: '' }))
        } catch (error) { current.latest ||= snapshot; setState(previous => ({ ...previous, status: 'Alterações ainda não guardadas neste aparelho.', error: error.message })); throw error }
      }
    })().finally(() => { current.job = null })
    return current.job
  }
  const flushRef = useRef(null)
  flushRef.current = async () => { await photosInProgress.current; await persist() }
  useEffect(() => registerDraftWriter(() => flushRef.current()), [])
  function queue(fields, files) {
    writer.current.fields = fields; writer.current.files = files
    setState(previous => ({ ...previous, fields, files, status: 'A guardar rascunho neste aparelho…' }))
    writer.current.latest = { fields, files }
    void persist().catch(() => {})
  }
  function change(name, value) { queue({ ...writer.current.fields, [name]: value }, writer.current.files) }
  async function validateAndAddPhotos(selected) {
    if (writer.current.files.length + selected.length > 20) throw new Error('Seleciona até 20 fotografias por consulta.')
    for (const file of selected) {
      if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 4 * 1024 * 1024) throw new Error('Usa JPEG ou PNG, até 4 MB por fotografia.')
      const image = await createImageBitmap(file)
      const valid = image.width <= 8000 && image.height <= 8000 && image.width * image.height <= 24000000
      image.close()
      if (!valid) throw new Error('Cada fotografia pode ter até 8000 píxeis por lado e 24 megapíxeis.')
    }
    if (writer.current.files.length + selected.length > 20) throw new Error('Seleciona até 20 fotografias por consulta.')
    queue({ ...writer.current.fields, photoIds: [...(writer.current.fields.photoIds || []), ...selected.map(() => crypto.randomUUID())] }, [...writer.current.files, ...selected])
  }
  function addPhotos(selected) {
    const job = (photosInProgress.current || Promise.resolve()).then(() => validateAndAddPhotos(selected))
    photosInProgress.current = job
    void job.finally(() => { if (photosInProgress.current === job) photosInProgress.current = null }).catch(() => {})
    return job
  }
  function removePhoto(index) {
    queue({ ...writer.current.fields, photoIds: writer.current.fields.photoIds.filter((_, i) => i !== index) }, writer.current.files.filter((_, i) => i !== index))
  }
  async function clear() {
    await persist()
    await session.vault.remove(scope, writer.current.revision)
    writer.current.revision = 0; writer.current.fields = null; writer.current.files = []
    setComparison(null)
    setState({ fields: null, files: [], error: '', status: 'Cópia temporária removida deste aparelho.' })
  }
  function acceptCurrentVersion() {
    writer.current.baseVersion = detail.version
    setState(previous => ({ ...previous }))
  }
  async function compareSaved() { setComparison(await session.vault.read(scope) || { revision: 0, fields: null, files: [] }) }
  function replaceCompared() {
    if (!comparison) return
    writer.current.revision = comparison.revision
    setComparison(null)
    queue(writer.current.fields, writer.current.files)
  }
  return { ...state, conflict: !!state.fields && writer.current.baseVersion !== detail.version, change, addPhotos, removePhoto, flush: () => flushRef.current(), clear, acceptCurrentVersion,
    comparison, compareSaved, replaceCompared, available: !!session?.vault }
}
