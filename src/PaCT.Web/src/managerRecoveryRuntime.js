import { apiRequest } from './identityApi'
import { checkpointRecord, recoveryCipher, readRecoveryTicket, writeRecoveryTicket, dropRecoveryTicket } from './managerRecoveryStorage'

const sensitive = element => element.type === 'password' || /password|token|secret|passkey|credential|csrf/i.test(element.name) || element.name === 'code' || element.autocomplete === 'one-time-code'
const controls = form => [...form.querySelectorAll('input[name],select[name],textarea[name]')].filter(element => !sensitive(element) && !['file', 'submit', 'button'].includes(element.type))
function formKey(form) {
  const context = []; for (let node = form; node; node = node.parentElement) if (node.dataset?.cardId) context.push(node.dataset.cardId)
  return form.dataset.recoveryKey || JSON.stringify([context, form.closest('dialog')?.getAttribute('aria-label'), controls(form).map(element => [element.name, element.type])])
}
function fields(form) { return controls(form).map(element => ({ name: element.name, type: element.type, value: element.value, checked: element.checked, selected: element.multiple ? [...element.selectedOptions].map(option => option.value) : null })) }
function restoreFields(form, saved) {
  const elements = controls(form)
  for (const [index, input] of saved.entries()) {
    const element = elements[index]
    if (!element || element.name !== input.name || element.type !== input.type || element.readOnly) continue
    if (['checkbox', 'radio'].includes(element.type)) { if (element.value === input.value) element.checked = input.checked }
    else if (element.tagName === 'SELECT') {
      const selected = input.selected || [input.value]
      for (const option of element.options) option.selected = selected.includes(option.value)
    } else element.value = input.value
  }
}

export async function createManagerRecovery(profile, reportError) {
  const navigation = performance.getEntriesByType('navigation')[0]?.type
  let ticket = readRecoveryTicket()
  const sameWindow = document.wasDiscarded === true || ['reload', 'back_forward'].includes(navigation)
  if (ticket?.owner !== profile.id || !sameWindow) ticket = null
  if (!ticket) ticket = { id: crypto.randomUUID(), owner: profile.id, interrupted: false }
  const result = await apiRequest('identity/manager-recovery-key', { windowId: ticket.id, envelope: ticket.envelope || null })
  ticket.envelope = result.envelope
  const cipher = await recoveryCipher(result.key, profile.id, ticket.id)
  writeRecoveryTicket(ticket)
  const record = ticket.interrupted ? await checkpointRecord(ticket.id) : null
  const restored = record ? await cipher.open(record) : null
  if (restored && restored.owner !== profile.id) throw new Error('A proteção temporária não pertence a esta conta.')
  const values = new Map(Object.entries(restored?.values || {})), registrations = new Map(), dirty = new Set()
  const savedForms = new Map(Object.entries(restored?.forms || {})), applied = new WeakSet()
  // An interrupted command remains uncertain until its original identifier is
  // explicitly verified. Never restore a busy spinner or replay the command.
  for (const [scope, value] of values) if (scope.endsWith(':pending') && value) values.set(scope.slice(0, -7) + 'uncertain', true)
  let active = false, retired = false, generation = 0, prepared = null, job = Promise.resolve(), viewportRestored = false
  function hasPending() { return [...values.entries()].some(([scope, value]) => scope.endsWith(':pending') && !!value || value?.fields?.pending) }
  function currentForms() {
    for (const form of dirty) if (!form.isConnected) dirty.delete(form)
    return [...dirty].filter(form => form.matches('form[data-protect-draft]'))
  }
  function snapshot() {
    const forms = currentForms(), focused = document.activeElement
    const focusedForm = focused?.closest('form')
    return { format: 1, owner: profile.id, values: Object.fromEntries(values), forms: Object.fromEntries(forms.map(form => [formKey(form), fields(form)])),
      viewport: { y: scrollY, form: focusedForm && formKey(focusedForm), input: focusedForm ? controls(focusedForm).indexOf(focused) : -1,
        start: typeof focused?.selectionStart === 'number' ? focused.selectionStart : null, end: typeof focused?.selectionEnd === 'number' ? focused.selectionEnd : null,
        dialogs: [...document.querySelectorAll('dialog[open]')].map(dialog => ({ label: dialog.getAttribute('aria-label'), top: dialog.scrollTop })) } }
  }
  function prepare() {
    const version = ++generation
    job = job.catch(() => {}).then(async () => {
      if (retired || version !== generation || !currentForms().length && !hasPending()) return
      for (const [scope, registration] of registrations) values.set(scope, registration.read())
      const sealed = await cipher.seal(snapshot())
      if (!retired && version === generation) prepared = { version, sealed }
    })
    void job.catch(() => reportError('Não foi possível proteger temporariamente este preenchimento. Mantém o formulário aberto.'))
    return job
  }
  function dropCheckpoint() {
    ticket.interrupted = false
    try { if (readRecoveryTicket()?.id === ticket.id) writeRecoveryTicket(ticket) } catch { /* Storage error is reported by the next checkpoint. */ }
    return checkpointRecord(ticket.id, null)
  }
  async function checkpoint() {
    if (retired) return
    if (!currentForms().length && !hasPending()) { await dropCheckpoint(); return }
    ticket.interrupted = true; writeRecoveryTicket(ticket)
    await prepare()
    if (!retired && ticket.interrupted && prepared?.version === generation) await checkpointRecord(ticket.id, prepared.sealed)
  }
  function protect() { void checkpoint().catch(() => reportError('A proteção temporária falhou. Os campos continuam neste formulário aberto.')) }
  function changed() {
    if (!active || retired) return
    if (!navigator.onLine || document.visibilityState === 'hidden') protect()
    else void prepare()
  }
  function hydrate() {
    for (const form of document.querySelectorAll('form[data-protect-draft]')) {
      const key = formKey(form), saved = savedForms.get(key)
      if (!saved || applied.has(form)) continue
      applied.add(form); restoreFields(form, saved); dirty.add(form)
      window.dispatchEvent(new CustomEvent('pact:recovered-form', { detail: { form } }))
    }
    if (!viewportRestored && [...dirty].length && restored?.viewport) {
      viewportRestored = true
      requestAnimationFrame(() => {
        const view = restored.viewport
        for (const item of view.dialogs || []) { const dialog = [...document.querySelectorAll('dialog[open]')].find(node => node.getAttribute('aria-label') === item.label); if (dialog) dialog.scrollTop = item.top }
        window.scrollTo(0, view.y)
        const form = [...dirty].find(node => formKey(node) === view.form), input = form && controls(form)[view.input]
        if (input && !input.disabled) { input.focus({ preventScroll: true }); if (view.start !== null && ['text', 'search', 'tel', 'url', 'textarea'].includes(input.type)) input.setSelectionRange(view.start, view.end) }
      })
    }
  }
  function input(event) {
    const form = event.target.closest?.('form[data-protect-draft]')
    if (!form || sensitive(event.target)) return
    dirty.add(form); queueMicrotask(changed)
  }
  function reset(event) { dirty.delete(event.target); savedForms.delete(formKey(event.target)); queueMicrotask(changed) }
  function visibility() {
    if (document.visibilityState === 'hidden' || !navigator.onLine) protect()
    else { hydrate(); void dropCheckpoint().catch(() => reportError('Não foi possível retirar a cópia temporária já retomada.')) }
  }
  function pagehide(event) {
    if (event.persisted) { protect(); return }
    // Normal close/reload is not a saved session. In a system discard/crash this
    // event may not run; only that interrupted window retains its ticket.
    retired = true; generation++
    if (readRecoveryTicket()?.id === ticket.id) dropRecoveryTicket()
    void checkpointRecord(ticket.id, null).catch(() => {})
  }
  return {
    get(scope, initial) { return values.has(scope) ? values.get(scope) : typeof initial === 'function' ? initial() : initial },
    set(scope, value) { values.set(scope, value); changed() },
    register(scope, read) {
      const token = {}; registrations.set(scope, { token, read }); values.set(scope, read())
      return () => { if (registrations.get(scope)?.token === token) registrations.delete(scope); queueMicrotask(() => { if (!registrations.has(scope)) { values.delete(scope); changed() } }) }
    },
    start() {
      active = true; hydrate()
      const observer = new MutationObserver(hydrate); observer.observe(document.body, { childList: true, subtree: true })
      document.addEventListener('input', input, true); document.addEventListener('change', input, true); document.addEventListener('reset', reset, true)
      document.addEventListener('visibilitychange', visibility); document.addEventListener('freeze', protect); document.addEventListener('resume', visibility)
      window.addEventListener('offline', protect); window.addEventListener('online', visibility); window.addEventListener('pageshow', visibility); window.addEventListener('pagehide', pagehide)
      return () => {
        active = false; observer.disconnect()
        document.removeEventListener('input', input, true); document.removeEventListener('change', input, true); document.removeEventListener('reset', reset, true)
        document.removeEventListener('visibilitychange', visibility); document.removeEventListener('freeze', protect); document.removeEventListener('resume', visibility)
        window.removeEventListener('offline', protect); window.removeEventListener('online', visibility); window.removeEventListener('pageshow', visibility); window.removeEventListener('pagehide', pagehide)
        queueMicrotask(() => { if (!active) this.discard() })
      }
    },
    discard() { retired = true; generation++; if (readRecoveryTicket()?.id === ticket.id) dropRecoveryTicket(); void checkpointRecord(ticket.id, null).catch(() => {}); values.clear(); savedForms.clear(); dirty.clear() },
  }
}
