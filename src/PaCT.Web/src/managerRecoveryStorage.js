// Manager drafts only. No plaintext content or unwrapped key is persisted.
export const MANAGER_RECOVERY_DATABASE = 'PaCT.ManagerInterruption.v1'
export const MANAGER_RECOVERY_TICKET = 'pact.manager-interruption.window.v1'
export const RECOVERY_TTL = 8 * 60 * 60 * 1000
const encoder = new TextEncoder(), decoder = new TextDecoder()
async function database() {
  return new Promise((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open(MANAGER_RECOVERY_DATABASE, 2)
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('sessions')) request.result.createObjectStore('sessions', { keyPath: 'id' }) }
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(new Error('O armazenamento temporário está ocupado por outra versão.')) }
    request.onsuccess = () => { const db = request.result; if (blocked) { db.close(); return } db.onversionchange = () => db.close(); resolve(db) }
  })
}
export async function recoveryRecords(owner) {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readonly'), request = tx.objectStore('sessions').getAll()
      tx.oncomplete = () => resolve(request.result.filter(record => record.owner === owner))
      tx.onabort = tx.onerror = () => reject(tx.error || request.error)
    })
  } finally { db.close() }
}
export async function saveRecoveryRecord(record, expectedRevision, isCurrent = () => true) {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite'), store = tx.objectStore('sessions'), request = store.get(record.id)
      request.onsuccess = () => {
        if (!isCurrent() || (request.result?.revision || 0) !== expectedRevision || request.result && request.result.owner !== record.owner) { tx.abort(); return }
        try { store.put(record) } catch { tx.abort() }
      }
      tx.oncomplete = resolve
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('A cópia temporária mudou noutra janela.'))
    })
  } finally { db.close() }
}
export async function deleteRecoveryRecords(owner, id = null) {
  const db = await database()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite'), request = tx.objectStore('sessions').openCursor()
      request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (cursor.value.owner === owner && (id === null || cursor.key === id)) cursor.delete(); cursor.continue() }
      tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || request.error)
    })
  } finally { db.close() }
}
export function readRecoveryTicket() { try { return JSON.parse(sessionStorage.getItem(MANAGER_RECOVERY_TICKET) || 'null') } catch { return null } }
export function writeRecoveryTicket(ticket) { try { sessionStorage.setItem(MANAGER_RECOVERY_TICKET, JSON.stringify(ticket)) } catch { /* The encrypted record can still be discovered after reopening. */ } }
export function dropRecoveryTicket() { try { sessionStorage.removeItem(MANAGER_RECOVERY_TICKET) } catch { /* Storage may be disabled. */ } }

export async function recoveryCipher(rawKey, owner, windowId) {
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(rawKey), char => char.charCodeAt(0)), 'AES-GCM', false, ['encrypt', 'decrypt'])
  const additionalData = encoder.encode(`${MANAGER_RECOVERY_DATABASE}:${owner}:${windowId}`)
  const files = new WeakMap()
  async function encrypt(bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    return { iv, ciphertext: await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, bytes) }
  }
  async function decrypt(value) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: value.iv, additionalData }, key, value.ciphertext) }
  async function pack(value, attachments) {
    if (value instanceof File) {
      if (!files.has(value)) files.set(value, encrypt(await value.arrayBuffer()))
      const index = attachments.length; attachments.push(await files.get(value))
      return { $recoveryFile: index, name: value.name, type: value.type, modified: value.lastModified }
    }
    if (Array.isArray(value)) return Promise.all(value.map(item => pack(item, attachments)))
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([name, item]) => [name, await pack(item, attachments)])))
    return value
  }
  async function unpack(value, attachments) {
    if (value && Number.isInteger(value.$recoveryFile)) return new File([await decrypt(attachments[value.$recoveryFile])], value.name, { type: value.type, lastModified: value.modified })
    if (Array.isArray(value)) return Promise.all(value.map(item => unpack(item, attachments)))
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([name, item]) => [name, await unpack(item, attachments)])))
    return value
  }
  return {
    async seal(value) { const attachments = []; const payload = await pack(value, attachments); return { ...(await encrypt(encoder.encode(JSON.stringify(payload)))), attachments } },
    async open(record) { return unpack(JSON.parse(decoder.decode(await decrypt(record))), record.attachments || []) },
  }
}
