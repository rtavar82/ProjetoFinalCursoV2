/* global writePublicBuild */
const VERSION = '__BUILD_ID__'
const PRECACHE = ['__PRECACHE__']
const CACHE_PREFIX = 'pact-public-'
const CACHE_NAME = CACHE_PREFIX + VERSION

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let value
    try { value = event.data?.json() } catch { value = null }
    await self.registration.showNotification('PaCT', {
      body: value?.body || 'Existe uma atualização na aplicação.',
      tag: typeof value?.tag === 'string' ? value.tag : 'pact-update',
      data: { url: value?.url === '/#agenda' ? '/#agenda' : '/?view=payments' }, icon: '/app-icon-192.png',
    })
  })())
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const url = event.notification.data?.url === '/#agenda' ? '/#agenda' : '/?view=payments'
    if (clients.length) {
      try { await clients[0].focus() } catch { /* The tab can still receive its destination when the browser refuses focus. */ }
      clients[0].postMessage({ type: url === '/#agenda' ? 'PACT_OPEN_AGENDA' : 'PACT_OPEN_PAYMENTS' })
    } else await self.clients.openWindow(url)
  })())
})

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    await cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload', credentials: 'omit' })))
    // Updates wait. Only an explicit, coordinated approval can activate a waiting worker.
  })())
})

function ask(client, type) {
  return new Promise(resolve => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => { channel.port1.close(); resolve(null) }, 4000)
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data) }
    client.postMessage({ type }, [channel.port2])
  })
}

async function cleanUnusedPublicCaches() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const responses = await Promise.all(clients.map(client => ask(client, 'PACT_PAGE_VERSION')))
  if (responses.some(response => !response?.version)) return
  const used = new Set([VERSION, ...responses.map(response => response.version)])
  for (const key of await caches.keys()) if (key.startsWith(CACHE_PREFIX) && !used.has(key.slice(CACHE_PREFIX.length))) await caches.delete(key)
}

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try { await writePublicBuild(VERSION, new Date().toISOString()) } catch { /* Storage may be denied; online operation remains available. */ }
    await self.clients.claim()
    await cleanUnusedPublicCaches()
  })())
})

self.addEventListener('message', event => {
  if (event.data?.type === 'PACT_ACTIVATE_UPDATE') event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const consent = await Promise.all(clients.map(client => ask(client, 'PACT_CHECK_UPDATE')))
    if (consent.every(response => response?.allow === true)) await self.skipWaiting()
    else event.source?.postMessage({ type: 'PACT_UPDATE_BLOCKED' })
  })())
  if (event.data?.type === 'PACT_PAGE_READY') event.waitUntil(cleanUnusedPublicCaches())
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  // No API/private request, write, cross-origin response, query-string or token is cached.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || url.pathname.startsWith('/api/')) return
  if (request.mode === 'navigate') {
    if (url.pathname !== '/') return
    event.respondWith((async () => (await caches.open(CACHE_NAME)).match('/') .then(response => response || fetch(request)))())
    return
  }
  const knownPublicAsset = PRECACHE.includes(url.pathname) || /^\/assets\/[\w.-]+\.(js|css|woff2|svg|png)$/.test(url.pathname)
  if (!knownPublicAsset) return
  event.respondWith((async () => {
    const current = await caches.open(CACHE_NAME)
    let response = await current.match(url.pathname)
    if (response) return response
    // An older open tab may still need its own hashed public bundle.
    for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX)) {
      response = await (await caches.open(name)).match(url.pathname)
      if (response) return response
    }
    return fetch(request) // Missing assets never become an HTML fallback.
  })())
})
