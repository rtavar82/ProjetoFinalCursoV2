import { installManagerWriteRecovery } from './managerWriteRecovery'
import { apiRequest } from './identityApi'
import { recoveryRecords, saveRecoveryRecord, deleteRecoveryRecords, recoveryCipher, readRecoveryTicket, writeRecoveryTicket, dropRecoveryTicket, RECOVERY_TTL } from './managerRecoveryStorage'

// A lease is held by the browser, not by a timeout: another live tab can never
// adopt or overwrite this window, even if it is suspended for several hours.
async function lease(id) {
  if (!navigator.locks) throw new Error('Este navegador não permite isolar a recuperação entre janelas.')
  return new Promise((resolve, reject) => {
    navigator.locks.request('PaCT.ManagerRecovery:' + id, { ifAvailable: true }, lock => {
      if (!lock) { resolve(null); return }
      return new Promise(release => resolve(release))
    }).catch(reject)
  })
}
async function keyFor(id, envelope, owner) {
  const csrf = await apiRequest('identity/csrf')
  const response = await fetch('/api/identity/manager-recovery-key', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', 'X-PaCT-CSRF': csrf.token, 'X-PaCT-Account': owner }, body: JSON.stringify({ windowId: id, envelope }),
  })
  if (!response.ok) throw new Error('Não foi possível preparar a proteção temporária.')
  return response.json()
}
export function createManagerRecovery(profile, reportError, reportRecovered) {
  const writeListeners = new Set(), activeWrites = new Set()
  let lastForm = null
  function notifyWrites() { for (const listener of writeListeners) listener() }
  const entries = new Map(), registrations = new Map(), edited = new Set(), blockedRecords = new Set()
  let viewportApplied = false, storageKnown = false, hasCheckpoint = false
  let durableIntents = new Map()
  const intentId = (scope, value) => scope.startsWith('write:') ? value?.key : value?.fields?.pending?.operationId || (scope.startsWith('testimonial:') ? value?.fields?.operationId : null) || (scope.endsWith(':pending') ? value?.operationId : null)
  let id, cipher, envelope, revision = 0, release, timer, expiryTimer, active = false, retired = false, initializing, ready = false, job = Promise.resolve(), notified = false, channel
  function warn() { reportError('Não foi possível guardar a recuperação temporária. Mantém o formulário aberto para conservar o preenchimento.') }
  function content() { return [...entries.keys()].some(scope => !scope.startsWith('view:')) }
  function prune() {
    const now = Date.now()
    for (const [scope, entry] of entries) if (!scope.startsWith('view:') && (!Number.isFinite(entry.updatedAt) || now - entry.updatedAt >= RECOVERY_TTL || entry.updatedAt > now + 60000)) entries.delete(scope)
  }
  async function initialize() {
    if (retired || ready || !navigator.onLine) return
    if (initializing) return initializing
    initializing = (async () => {
      const records = await recoveryRecords(profile.id), ticket = readRecoveryTicket(), now = Date.now()
      storageKnown = true; hasCheckpoint = records.some(record => record.expiresAt > now)
      const candidates = records.filter(record => record.expiresAt > now && !blockedRecords.has(record.id)).sort((a, b) => (b.id === ticket?.id) - (a.id === ticket?.id) || b.updatedAt - a.updatedAt)
      for (const record of records) if (record.expiresAt <= now) await deleteRecoveryRecords(profile.id, record.id)
      let chosen
      for (const candidate of candidates) { release = await lease(candidate.id); if (release) { chosen = candidate; break } }
      if (!release) { id = crypto.randomUUID(); release = await lease(id) } else id = chosen.id
      hasCheckpoint = !!chosen
      if (!release) throw new Error('Não foi possível isolar esta janela.')
      try {
        const key = await keyFor(id, chosen?.envelope || null, profile.id)
        if (retired) { release(); release = null; return }
        envelope = key.envelope; cipher = await recoveryCipher(key.key, profile.id, id); revision = chosen?.revision || 0
        if (chosen) {
          let saved
          try { saved = await cipher.open(chosen) } catch (error) { blockedRecords.add(chosen.id); throw error }
          if (saved.owner !== profile.id || saved.format !== 2) throw new Error('Cópia temporária inválida.')
          durableIntents = new Map(Object.entries(saved.entries).filter(([scope, entry]) => now - entry.updatedAt < RECOVERY_TTL && intentId(scope, entry.value)).map(([scope, entry]) => [scope, intentId(scope, entry.value)]))
          for (const [scope, entry] of Object.entries(saved.entries)) if (!edited.has(scope)) entries.set(scope, entry)
          prune()
          if (!content()) for (const scope of entries.keys()) if (scope.startsWith('view:')) entries.delete(scope)
          for (const [scope, registration] of registrations) if (entries.has(scope) && !edited.has(scope)) registration.restore(entries.get(scope).value)
          if (content() && !notified) { notified = true; reportRecovered() }
        }
        ready = true; notifyWrites(); writeRecoveryTicket({ id, owner: profile.id })
        if (edited.size) schedule()
      } catch (error) { release?.(); release = null; cipher = null; throw error }
    })().catch(() => { warn() }).finally(() => { initializing = null })
    return initializing
  }
  function schedule() { if (retired) return; clearTimeout(timer); timer = setTimeout(() => { void runtime.flush() }, 250) }
  const runtime = {
    owner: profile.id,
    isActive() { return active && !retired },
    writeTicket(path, submitted, key, form = null, command = false, explicitScope = null) {
      const descriptor = form || lastForm
      const body = command ? JSON.parse(submitted) : null
      const proposed = 'write:' + path + (command ? ':' + (body.id || descriptor?.key || body.action || 'new') : '')
      const scope = explicitScope && entries.get(explicitScope)?.value.path === path ? explicitScope : proposed
      const existing = entries.get(scope)?.value
      if (existing && existing.submitted !== submitted) throw new Error('Existe um envio anterior sem confirmação para este registo. Verifica esse resultado antes de enviar alterações diferentes.')
      const ticket = existing || { path, submitted, key, form: descriptor, command, createdAt: Date.now() }
      activeWrites.add(scope)
      return { key: ticket.key, headerKey: command ? undefined : ticket.key, command, submitted: ticket.submitted,
        async support(supported) { if (existing && !supported) { const error = new Error('Não foi possível verificar com segurança o envio anterior. O preenchimento foi mantido.'); error.status = 409; error.keepRecovery = true; throw error } if (supported) { if (!entries.has(scope)) runtime.set(scope, ticket, ticket.createdAt); await runtime.protectIntent(scope, ticket.key) } },
        async complete(clearForm = true) { runtime.remove(scope); activeWrites.delete(scope); if (command) runtime.completeCommand(ticket.key); if (clearForm && ticket.form && runtime.canClearForm(ticket.form)) { runtime.remove('form:' + ticket.form.key); runtime.removePrefix('phone:' + ticket.form.key + ':'); for (const prefix of ticket.form.scopes) runtime.removePrefix(prefix) } if (lastForm?.key === ticket.form?.key) lastForm = null; notifyWrites(); await runtime.flush() },
        async reject() { runtime.remove(scope); activeWrites.delete(scope); notifyWrites(); await runtime.flush() },
        uncertain() { activeWrites.delete(scope); notifyWrites() },
      }
    },
    subscribeWrites(listener) { writeListeners.add(listener); return () => writeListeners.delete(listener) },
    lastSubmittedForm() { return lastForm },
    completeCommand(operationId) { for (const [scope, entry] of [...entries]) { if (scope.startsWith('write:') && entry.value.command && entry.value.key === operationId) { runtime.remove(scope); activeWrites.delete(scope) } else if (scope.endsWith(':pending') && entry.value?.operationId === operationId) { runtime.remove(scope); registrations.get(scope)?.restore(null) } } notifyWrites() },
    captureForm(form) {
      if (!form?.dataset.recoveryKey) return null
      const key = form.dataset.recoveryKey, scopes = JSON.parse(form.dataset.recoveryScopes || '[]')
      const matches = scope => scope === 'form:' + key || scope.startsWith('phone:' + key + ':') || scopes.some(prefix => scope.startsWith(prefix))
      return { key, scopes, generic: form.dataset.recoveryNative === 'true', generations: Object.fromEntries([...entries].filter(([scope]) => matches(scope)).map(([scope, entry]) => [scope, entry.changeId])) }
    },
    canClearForm(form) {
      const matches = scope => scope === 'form:' + form.key || scope.startsWith('phone:' + form.key + ':') || form.scopes.some(prefix => scope.startsWith(prefix))
      return [...entries].filter(([scope]) => matches(scope)).every(([scope, entry]) => entry.changeId === form.generations?.[scope])
    },
    formTicket(key) { if (!key) return null; for (const [scope, entry] of entries) if (scope.startsWith('write:') && entry.value.form?.key === key && !activeWrites.has(scope)) return { scope, path: entry.value.path || scope.slice(6), ...entry.value }; return null },
    resetPrefix(prefix) { runtime.removePrefix(prefix); for (const [scope, registration] of registrations) if (scope.startsWith(prefix)) registration.reset?.() },
    get(scope, initial) { prune(); if (entries.has(scope)) return entries.get(scope).value; const value = typeof initial === 'function' ? initial() : initial; if (scope.startsWith('view:')) entries.set(scope, { value, updatedAt: Date.now() }); return value },
    set(scope, value, updatedAt = Date.now()) { if (!scope || retired) return; entries.set(scope, { value, updatedAt, changeId: crypto.randomUUID() }); edited.add(scope); if (scope.startsWith('write:')) notifyWrites(); schedule() },
    remove(scope) { entries.delete(scope); edited.add(scope); if (scope.startsWith('write:')) notifyWrites(); schedule() },
    removePrefix(prefix) { for (const scope of entries.keys()) if (scope.startsWith(prefix)) { entries.delete(scope); edited.add(scope) } schedule() },
    register(scope, restore, reset) { const token = { restore, reset }; registrations.set(scope, token); return () => { if (registrations.get(scope) === token) registrations.delete(scope) } },
    hasContent() { prune(); return content() },
    clearContent() { lastForm = null; for (const scope of entries.keys()) if (!scope.startsWith('view:') && !scope.startsWith('write:') && !scope.endsWith(':pending')) { entries.delete(scope); edited.add(scope) } schedule() },
    async protectIntent(scope, operation) {
      const inactive = () => { const error = new Error('Este formulário já não está ativo. Volta a abri-lo na conta atual.'); error.status = 409; return error }
      if (!active || retired) throw inactive()
      await runtime.flush()
      if (!active || retired) throw inactive()
      if (durableIntents.get(scope) === operation || storageKnown && !hasCheckpoint) return
      const error = new Error('Não foi possível proteger o identificador deste envio. O envio não foi iniciado. Mantém o formulário aberto e verifica o armazenamento do navegador antes de tentar novamente.')
      error.status = 409
      throw error
    },
    flush() {
      clearTimeout(timer)
      job = job.catch(() => {}).then(async () => {
        if (retired) return false
        await initialize(); if (!ready || retired) return false
        prune()
        if (!content()) { await deleteRecoveryRecords(profile.id, id); revision = 0; hasCheckpoint = false; durableIntents.clear(); return true }
        const focused = document.activeElement, focusedForm = focused?.closest('form[data-recovery-key]')
        if (focusedForm && focused.name && focused.type !== 'password') entries.set('view:viewport', { updatedAt: Date.now(), value: { form: focusedForm.dataset.recoveryKey, name: focused.name, y: scrollY, start: focused.selectionStart, end: focused.selectionEnd } })
        const snapshot = { format: 2, owner: profile.id, entries: Object.fromEntries(entries) }
        const sealed = await cipher.seal(snapshot)
        if (retired) return false
        const updatedAt = Math.max(...[...entries.values()].map(entry => entry.updatedAt))
        await saveRecoveryRecord({ id, owner: profile.id, envelope, updatedAt, expiresAt: updatedAt + RECOVERY_TTL, revision: revision + 1, ...sealed }, revision, () => !retired)
        revision++; hasCheckpoint = true; durableIntents = new Map(Object.entries(snapshot.entries).filter(([scope, entry]) => intentId(scope, entry.value)).map(([scope, entry]) => [scope, intentId(scope, entry.value)])); reportError(''); return true
      }).catch(() => { warn(); return false })
      return job
    },
    async discard() {
      retired = true; clearTimeout(timer); entries.clear(); edited.clear(); dropRecoveryTicket()
      channel?.postMessage({ type: 'discard', owner: profile.id })
      await job.catch(() => {})
      await deleteRecoveryRecords(profile.id).catch(warn)
      release?.(); release = null; cipher = null
    },
    start() {
      active = true
      const uninstallWrites = installManagerWriteRecovery(runtime)
      void initialize()
      const save = () => { void runtime.flush() }
      const resume = () => { void initialize() }
      const visibility = () => { if (document.visibilityState === 'hidden') save(); else resume() }
      const restoreViewport = () => {
        const view = entries.get('view:viewport')?.value
        if (!ready || viewportApplied || !view || [...edited].some(scope => !scope.startsWith('view:'))) return
        const form = [...document.querySelectorAll('form[data-recovery-key]')].find(form => form.dataset.recoveryKey === view.form)
        const input = form && [...form.elements].find(input => input.name === view.name && !input.disabled)
        if (!input) return
        viewportApplied = true
        requestAnimationFrame(() => { if (!input.isConnected) return; window.scrollTo(0, view.y); input.focus({ preventScroll: true }); if (view.start !== null && ['text', 'search', 'tel', 'url', 'textarea'].includes(input.type)) input.setSelectionRange(view.start, view.end) })
      }
      const observer = new MutationObserver(restoreViewport); observer.observe(document.body, { childList: true, subtree: true })
      const expired = () => { retired = true; clearTimeout(timer); entries.clear(); cipher = null; release?.(); release = null }
      const submitted = event => { const descriptor = runtime.captureForm(event.target); if (descriptor) lastForm = descriptor }
      document.addEventListener('submit', submitted, true)
      const signedOut = () => { void runtime.discard() }
      window.addEventListener('offline', save); window.addEventListener('online', resume); window.addEventListener('pagehide', save)
      window.addEventListener('pact:signed-out', signedOut); window.addEventListener('pact:session-expired', expired); document.addEventListener('visibilitychange', visibility)
      expiryTimer = setInterval(() => { prune(); if (ready) void runtime.flush() }, 60000)
      try { channel = new BroadcastChannel('PaCT.ManagerRecovery') } catch { warn() }
      const ownedChannel = channel
      if (channel) channel.onmessage = event => { if (event.data?.type === 'discard' && event.data.owner === profile.id) { retired = true; clearTimeout(timer); entries.clear(); cipher = null; release?.(); release = null; void job.finally(() => deleteRecoveryRecords(profile.id)).catch(warn); window.dispatchEvent(new Event('pact:session-expired')) } }
      return () => {
        active = false; document.removeEventListener('submit', submitted, true); observer.disconnect(); ownedChannel?.close(); uninstallWrites(); clearInterval(expiryTimer)
        window.removeEventListener('offline', save); window.removeEventListener('online', resume); window.removeEventListener('pagehide', save)
        window.removeEventListener('pact:signed-out', signedOut); window.removeEventListener('pact:session-expired', expired); document.removeEventListener('visibilitychange', visibility)
        queueMicrotask(() => { if (!active) { void runtime.flush().finally(() => { retired = true; release?.(); release = null; cipher = null; channel?.close() }) } })
      }
    },
  }
  return runtime
}
