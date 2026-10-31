// Only encrypted interruption checkpoints go into this database. The protected
// key envelope and window identity live in sessionStorage, never a draft list.
export const MANAGER_RECOVERY_DATABASE = 'PaCT.ManagerInterruption.v1'
export const MANAGER_RECOVERY_TICKET = 'pact.manager-interruption.window.v1'
const encoder = new TextEncoder(), decoder = new TextDecoder()

async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MANAGER_RECOVERY_DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'id' })
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db) }
  })
}
export async function checkpointRecord(id, value) {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('sessions', value === undefined ? 'readonly' : 'readwrite')
      const store = transaction.objectStore('sessions')
      const request = value === undefined ? store.get(id) : value === null ? store.delete(id) : store.put({ id, ...value })
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = transaction.onerror = () => reject(transaction.error || request.error)
    })
  } finally { db.close() }
}
export function readRecoveryTicket() {
  try { return JSON.parse(sessionStorage.getItem(MANAGER_RECOVERY_TICKET) || 'null') } catch { return null }
}
export function writeRecoveryTicket(ticket) { sessionStorage.setItem(MANAGER_RECOVERY_TICKET, JSON.stringify(ticket)) }
export function dropRecoveryTicket() { sessionStorage.removeItem(MANAGER_RECOVERY_TICKET) }

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
