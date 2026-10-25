// This database stores public build metadata only, never account or business records.
const databaseName = 'PaCT.Public.v1'
function openPublicDatabase() {
  return new Promise((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('metadata')
    request.onsuccess = () => { if (blocked) { request.result.close(); return } request.result.onversionchange = () => request.result.close(); resolve(request.result) }
    request.onerror = () => reject(new Error('O armazenamento público não está disponível neste navegador.'))
    request.onblocked = () => { blocked = true; reject(new Error('Fecha outras janelas para atualizar o armazenamento público.')) }
  })
}
export async function readPublicBuild() {
  const database = await openPublicDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('metadata', 'readonly')
    const request = transaction.objectStore('metadata').get('current-build')
    request.onsuccess = () => {
      const value = request.result
      resolve(value && /^[a-f0-9]{20}$/.test(value.version) && Number.isFinite(Date.parse(value.cachedAt)) ? { version: value.version, cachedAt: value.cachedAt } : null)
    }
    transaction.oncomplete = () => database.close()
    transaction.onabort = () => { database.close(); reject(new Error('Não foi possível ler a informação pública offline.')) }
    request.onerror = () => reject(new Error('Não foi possível ler a informação pública offline.'))
  })
}
export async function writePublicBuild(version, cachedAt) {
  if (!/^[a-f0-9]{20}$/.test(version) || !Number.isFinite(Date.parse(cachedAt))) throw new Error('Invalid public build metadata.')
  const database = await openPublicDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('metadata', 'readwrite')
    transaction.objectStore('metadata').put({ version, cachedAt }, 'current-build')
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onabort = transaction.onerror = () => { database.close(); reject(new Error('Não foi possível guardar a informação pública offline.')) }
  })
}
