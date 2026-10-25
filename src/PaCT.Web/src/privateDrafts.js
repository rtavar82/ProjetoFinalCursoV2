import { apiRequest } from './identityApi'

const databaseName = 'PaCT.PrivateDrafts.v1'
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const changedEvent = 'pact:private-drafts-changed'
export const PRIVATE_DRAFTS_CHANGED = changedEvent

function openDatabase() {
  return new Promise((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('vaults', { keyPath: 'owner' })
      db.createObjectStore('drafts', { keyPath: 'slot' }).createIndex('owner', 'owner')
      db.createObjectStore('attachments', { keyPath: 'id' }).createIndex('slot', 'slot')
    }
    request.onsuccess = () => { if (blocked) { request.result.close(); return } request.result.onversionchange = () => request.result.close(); resolve(request.result) }
    request.onerror = () => reject(new Error('Não foi possível abrir o armazenamento privado deste aparelho.'))
    request.onblocked = () => { blocked = true; reject(new Error('Fecha outras janelas para preparar o armazenamento privado.')) }
  })
}

async function transaction(stores, mode, work) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode, { durability: mode === 'readwrite' ? 'strict' : 'default' })
    let result
    let failure
    const fail = error => { failure = error; tx.abort() }
    tx.oncomplete = () => { db.close(); resolve(result) }
    tx.onabort = tx.onerror = () => { db.close(); reject(failure || new Error('Não foi possível guardar o rascunho neste aparelho. Verifica o espaço disponível.')) }
    try { work(tx, value => { result = value }, fail) } catch (error) { fail(error) }
  })
}
function get(store, key) { return transaction([store], 'readonly', (tx, done) => { tx.objectStore(store).get(key).onsuccess = event => done(event.target.result) }) }
function validateData(data) {
  const json = JSON.stringify(data)
  if (json.length > 200000) throw new Error('O rascunho excede o limite de texto permitido.')
  if (Object.keys(data.fields || {}).some(key => /password|token|secret|recovery|installationCode/i.test(key))) throw new Error('Credenciais e tokens não podem ser guardados em rascunhos.')
  return json
}
const conflict = () => new Error('Este rascunho mudou noutra janela. A tua edição foi mantida; recupera e compara a outra versão antes de substituir.')

export async function openPrivateVault(owner, request = apiRequest) {
  if (!window.isSecureContext || !crypto.subtle || !indexedDB) throw new Error('O armazenamento privado exige HTTPS e suporte de cifragem neste navegador.')
  if (!navigator.onLine) throw new Error('Liga-te e inicia sessão para desbloquear os rascunhos. Os dados cifrados continuam neste aparelho.')
  let stored = await get('vaults', owner)
  let response = await request('identity/local-draft-key', { sealedKey: stored?.sealedKey ?? null })
  if (response.owner !== owner) throw new Error('A conta mudou. Inicia sessão novamente antes de recuperar rascunhos.')
  if (!stored) {
    stored = await transaction(['vaults'], 'readwrite', (tx, done) => {
      const store = tx.objectStore('vaults')
      store.get(owner).onsuccess = event => {
        const current = event.target.result
        if (current) done(current)
        else { const value = { owner, sealedKey: response.sealedKey }; store.add(value); done(value) }
      }
    })
    if (stored.sealedKey !== response.sealedKey) response = await request('identity/local-draft-key', { sealedKey: stored.sealedKey })
  }
  if (response.owner !== owner || response.sealedKey !== stored.sealedKey) throw new Error('Não foi possível validar a proteção dos rascunhos.')
  const raw = Uint8Array.from(atob(response.key), c => c.charCodeAt(0))
  if (raw.length !== 32) throw new Error('A chave de rascunhos não é válida.')
  let key
  try { key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']) }
  finally { raw.fill(0); response.key = null }
  let locked = false
  const fileCache = new WeakMap()
  function check() { if (locked || !key) throw new Error('Os rascunhos estão bloqueados. Inicia sessão online para continuar.') }
  const additionalData = value => encoder.encode('PaCT.PrivateDrafts.v1:' + owner + ':' + value)
  async function slotOf(scope) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', additionalData(scope))), b => b.toString(16).padStart(2, '0')).join('') }
  async function seal(value, purpose) {
    check(); const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: additionalData(purpose) }, key, value)
    check(); return { iv, ciphertext }
  }
  async function unseal(value, purpose) {
    check()
    try { const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: value.iv, additionalData: additionalData(purpose) }, key, value.ciphertext); check(); return plain }
    catch { throw new Error('Não foi possível ler um rascunho cifrado. O original foi preservado.') }
  }
  async function read(scope) {
    check(); const slot = await slotOf(scope); const row = await get('drafts', slot)
    if (!row) return null
    const payload = JSON.parse(decoder.decode(await unseal(row, slot)))
    const files = []
    for (const file of payload.files || []) {
      const value = await get('attachments', slot + ':' + file.id)
      if (!value) throw new Error('Falta uma imagem do rascunho. Não descartes os dados existentes.')
      files.push(new File([await unseal(value, slot + ':' + file.id)], file.name, { type: file.type, lastModified: file.lastModified }))
    }
    return { ...payload, files, revision: row.revision }
  }
  async function save(scope, data, files, expectedRevision) {
    check(); if (files.length > 20 || files.some(file => file.size > 4 * 1024 * 1024)) throw new Error('Usa até 20 imagens de 4 MB por rascunho.')
    const slot = await slotOf(scope)
    const fileRows = []
    const metadata = []
    for (const file of files) {
      let cached = fileCache.get(file)
      if (!cached || cached.slot !== slot) {
        const id = crypto.randomUUID()
        cached = { slot, row: { id: slot + ':' + id, slot, ...await seal(await file.arrayBuffer(), slot + ':' + id) },
          metadata: { id, name: file.name, type: file.type, size: file.size, lastModified: file.lastModified } }
        fileCache.set(file, cached)
      }
      fileRows.push(cached.row); metadata.push(cached.metadata)
    }
    const payload = { ...data, scope, savedAt: new Date().toISOString(), files: metadata }
    const encrypted = await seal(encoder.encode(validateData(payload)), slot)
    const revision = expectedRevision + 1
    await transaction(['drafts', 'attachments'], 'readwrite', (tx, done, fail) => {
      const drafts = tx.objectStore('drafts'); const attachments = tx.objectStore('attachments')
      drafts.get(slot).onsuccess = event => {
        if ((event.target.result?.revision || 0) !== expectedRevision) { fail(conflict()); return }
        const retained = new Set(); const wanted = new Set(fileRows.map(file => file.id))
        attachments.index('slot').openKeyCursor(IDBKeyRange.only(slot)).onsuccess = event => {
          const cursor = event.target.result
          if (cursor) { if (wanted.has(cursor.primaryKey)) retained.add(cursor.primaryKey); else attachments.delete(cursor.primaryKey); cursor.continue() }
          else { for (const file of fileRows) if (!retained.has(file.id)) attachments.put(file) }
        }
        drafts.put({ slot, owner, revision, ...encrypted }); done(revision)
      }
    })
    window.dispatchEvent(new Event(changedEvent))
    return revision
  }
  async function remove(scope, expectedRevision) {
    check(); const slot = await slotOf(scope)
    await transaction(['drafts', 'attachments'], 'readwrite', (tx, done, fail) => {
      const drafts = tx.objectStore('drafts'); const attachments = tx.objectStore('attachments')
      drafts.get(slot).onsuccess = event => {
        if (!event.target.result) { done(); return }
        if (event.target.result.revision !== expectedRevision) { fail(conflict()); return }
        drafts.delete(slot)
        attachments.index('slot').openKeyCursor(IDBKeyRange.only(slot)).onsuccess = event => { const cursor = event.target.result; if (cursor) { attachments.delete(cursor.primaryKey); cursor.continue() } }
      }
    })
    window.dispatchEvent(new Event(changedEvent))
  }
  async function list() {
    check()
    const rows = await transaction(['drafts'], 'readonly', (tx, done) => { tx.objectStore('drafts').index('owner').getAll(owner).onsuccess = event => done(event.target.result) })
    return Promise.all(rows.map(async row => {
      const value = JSON.parse(decoder.decode(await unseal(row, row.slot)))
      return { scope: value.scope, kind: value.kind || 'Closure', title: value.title, resourceId: value.resourceId, savedAt: value.savedAt, revision: row.revision }
    }))
  }
  let persistent = false
  try { persistent = await navigator.storage?.persist?.() || false } catch { /* Storage remains best-effort; never claim persistence. */ }
  return { owner, read, save, remove, list, persistent, lock() { locked = true; key = null } }
}
