import { apiRequest } from './identityApi'
import { showSuccess, announceOperation } from './actionNotices'
import ActionButton from './ActionButton'
import { useContext, useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from 'react'
import { ManagerRecoveryContext, ManagerRecoveryFormContext } from './managerRecoveryContext'

const safe = input => input.name && !input.dataset.recoveryControlled && input.type !== 'password' && !/password|token|secret|passkey|credential|csrf|^code$/i.test(input.name) && input.autocomplete !== 'one-time-code'
// Native uncontrolled fields only; controlled models use useRecoveryState or
// useEditorState and are explicitly excluded from this native form adapter.
export default function RecoveryForm({ as: Element = 'form', ref: forwardedRef, recoveryKey, recoveryVersion = null, recoveryExclude = [], recoveryScopes = [], children, onSubmit, onReset, onRecovered, onVerified, elementProps = {}, ...props }) {
  const runtime = useContext(ManagerRecoveryContext), form = useRef(null)
  useImperativeHandle(forwardedRef, () => form.current)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [writeState, setWriteState] = useState(() => ({ key: recoveryKey, ticket: runtime?.formTicket(recoveryKey) || null }))
  const ticket = writeState.key === recoveryKey ? writeState.ticket : null
  const scope = 'form:' + recoveryKey
  useEffect(() => {
    if (!runtime) return
    let current = true
    const refresh = () => { if (current) setWriteState({ key: recoveryKey, ticket: runtime.formTicket(recoveryKey) }) }
    queueMicrotask(refresh)
    const stop = runtime.subscribeWrites(refresh)
    return () => { current = false; stop() }
  }, [runtime, recoveryKey])
  async function verify() {
    if (!ticket || checking) return
    setChecking(true); setError('')
    const clear = runtime.canClearForm(ticket.form)
    try {
      const result = await apiRequest(ticket.path, JSON.parse(ticket.submitted), { recoveryScope: ticket.scope, expectedAccount: runtime.owner })
      if (!runtime.isActive()) return
      if (result.saved === false || result.confirmed === false) throw new Error(result.message || 'A gravação anterior não foi confirmada.')
      if (clear && runtime.canClearForm(ticket.form)) { form.current?.reset(); onVerified?.(result) }
      if (ticket.command) announceOperation(JSON.parse(ticket.submitted), result)
      else showSuccess(result.message || 'A gravação anterior foi confirmada.')
    } catch (failure) { setError(failure.message) } finally { setChecking(false) }
  }
  const restore = useEffectEvent(saved => {
      const element = form.current
      if (saved.baseVersion !== null && saved.baseVersion !== recoveryVersion) { setError('O registo mudou. Revê os dados atuais antes de confirmar o preenchimento recuperado.') }
      for (const field of saved.fields) {
        if (recoveryExclude.includes(field.name)) continue
        const input = [...element.elements].find(item => item.name === field.name && item.type === field.type && (!['checkbox', 'radio'].includes(item.type) || item.value === field.value))
        if (!input || !safe(input) || input.readOnly) continue
        if (input.type === 'file') { const transfer = new DataTransfer(); field.files.forEach(file => transfer.items.add(file)); input.files = transfer.files }
        else if (['checkbox', 'radio'].includes(input.type)) input.checked = field.checked
        else if (input.multiple) { for (const option of input.options) option.selected = field.selected.includes(option.value) }
        else input.value = field.value
      }
      element.dispatchEvent(new Event('pact:recovered-form', { bubbles: true }))
      onRecovered?.(element)
    })
  const capture = useEffectEvent(() => {
    const element = form.current
    const fields = [...element.elements].filter(input => safe(input) && !recoveryExclude.includes(input.name) && !['submit', 'button'].includes(input.type)).map(input => ({ name: input.name, type: input.type, value: input.type === 'file' ? '' : input.value, checked: input.checked, selected: input.multiple && input.options ? [...input.selectedOptions].map(option => option.value) : [], files: input.type === 'file' ? [...input.files] : [] }))
    runtime.set(scope, { baseVersion: recoveryVersion, fields })
  })
  useEffect(() => {
    if (!runtime || !recoveryKey) return
    const element = form.current
    let current = true
    const saved = runtime.get(scope, null); if (saved) queueMicrotask(() => { if (current) restore(saved) })
    const stop = runtime.register(scope, saved => restore(saved))
    function changed() { capture() }
    element.addEventListener('input', changed); element.addEventListener('change', changed)
    return () => { current = false; stop(); element.removeEventListener('input', changed); element.removeEventListener('change', changed) }
  }, [runtime, recoveryKey, scope])
  return <ManagerRecoveryFormContext.Provider value={recoveryKey}>{error && <div className="notice error" role="alert"><p>{error}</p><button type="button" className="secondary" onClick={() => setError('')}>Revi o registo atual; manter o preenchimento</button></div>}<>{ticket && <div className="notice" role="status"><p>Existe uma gravação anterior sem confirmação. Verifica o resultado antes de voltar a guardar.</p><ActionButton variant="secondary" disabled={checking} onClick={verify}>Verificar envio anterior</ActionButton></div>}<Element {...props} {...elementProps} inert={!!ticket || checking || props.inert} data-pending-command={checking || props['data-pending-command'] ? 'true' : undefined} ref={form} data-recovery-native="true" data-recovery-key={recoveryKey} data-recovery-scopes={JSON.stringify(recoveryScopes)} onReset={event => { runtime?.remove(scope); runtime?.resetPrefix('phone:' + recoveryKey + ':'); for (const prefix of recoveryScopes) runtime?.resetPrefix(prefix); setError(''); onReset?.(event) }} onSubmit={event => { if (error || ticket || checking) { event.preventDefault(); return } onSubmit?.(event) }}>{children}</Element></></ManagerRecoveryFormContext.Provider>
}
