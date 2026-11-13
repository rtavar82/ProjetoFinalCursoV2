import { useContext, useLayoutEffect, useRef } from 'react'
import useRecoveryState from './useRecoveryState'
import { ManagerRecoveryContext } from './managerRecoveryContext'
import { validateJpegPng } from './photoValidation'

// Persistence is opt-in by record scope and only available to authenticated managers.
export default function useEditorState(initialFields, version, scope = null) {
  const recovery = useContext(ManagerRecoveryContext)
  const [state, setState, getCurrent] = useRecoveryState(scope, () => ({ fields: { ...initialFields }, files: [], baseVersion: version }))
  const photoJob = useRef(null), lifetime = useRef({ active: true, scope })
  useLayoutEffect(() => { const token = { active: true, scope }; lifetime.current = token; photoJob.current = null; return () => { token.active = false } }, [scope])
  function isActive() { return lifetime.current.active && lifetime.current.scope === scope }
  function assertActive() { if (!isActive()) { const error = new Error('Este formulário já não está ativo. Volta a abri-lo na conta atual.'); error.status = 409; throw error } }
  function update(next) { setState(previous => ({ ...previous, ...next })) }
  function change(name, value) { update({ ...getCurrent(), fields: { ...getCurrent().fields, [name]: value } }) }
  async function validatePhotos(selected) {
    assertActive(); const token = lifetime.current
    if (getCurrent().files.length + selected.length > 20) throw new Error('Seleciona até 20 fotografias de cada vez.')
    for (const file of selected) await validateJpegPng(file)
    if (!token.active || lifetime.current !== token) return
    const previous = getCurrent()
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
    const previous = getCurrent()
    update({ fields: { ...previous.fields, photoIds: (previous.fields.photoIds || []).filter((_, i) => i !== index) }, files: previous.files.filter((_, i) => i !== index) })
  }
  function reset(nextVersion = version, fields = initialFields) { if (!isActive()) return; setState({ fields: { ...fields }, files: [], baseVersion: nextVersion }, false) }
  return { ...state, change, addPhotos, removePhoto, reset, ready: async () => { assertActive(); const token = lifetime.current; await photoJob.current; assertActive(); if (token !== lifetime.current) throw new Error('O formulário mudou durante a preparação.'); return getCurrent() },
    owner: recovery?.owner, isActive, assertActive, conflict: state.baseVersion !== version, acceptCurrentVersion: () => update({ ...getCurrent(), baseVersion: version }), flush: () => recovery?.flush(), protectIntent: operation => recovery?.protectIntent(scope, operation) }
}
