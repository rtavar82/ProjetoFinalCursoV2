import { useRef, useState } from 'react'
import { validateJpegPng } from './photoValidation'

// Ordinary form state: lives only while the editor is mounted. No storage or API.
export default function useEditorState(initialFields, version) {
  const initial = useRef(initialFields)
  const [state, setState] = useState(() => ({ fields: { ...initialFields }, files: [] }))
  const current = useRef(state)
  const [baseVersion, setBaseVersion] = useState(version)
  const photoJob = useRef(null)
  function update(next) { current.current = next; setState(next) }
  function change(name, value) { update({ ...current.current, fields: { ...current.current.fields, [name]: value } }) }
  async function validatePhotos(selected) {
    if (current.current.files.length + selected.length > 20) throw new Error('Seleciona até 20 fotografias de cada vez.')
    for (const file of selected) await validateJpegPng(file)
    const previous = current.current
    if (previous.files.length + selected.length > 20) throw new Error('Seleciona até 20 fotografias de cada vez.')
    update({ fields: { ...previous.fields, photoIds: [...(previous.fields.photoIds || []), ...selected.map(() => crypto.randomUUID())] }, files: [...previous.files, ...selected] })
  }
  function addPhotos(selected) {
    const job = (photoJob.current || Promise.resolve()).then(() => validatePhotos(selected))
    photoJob.current = job
    void job.finally(() => { if (photoJob.current === job) photoJob.current = null }).catch(() => {})
    return job
  }
  function removePhoto(index) {
    const previous = current.current
    update({ fields: { ...previous.fields, photoIds: (previous.fields.photoIds || []).filter((_, i) => i !== index) }, files: previous.files.filter((_, i) => i !== index) })
  }
  function reset(nextVersion = version, fields = initial.current) { update({ fields: { ...fields }, files: [] }); setBaseVersion(nextVersion) }
  return { ...state, change, addPhotos, removePhoto, reset, ready: async () => { await photoJob.current; return current.current },
    conflict: baseVersion !== version, acceptCurrentVersion: () => setBaseVersion(version) }
}
