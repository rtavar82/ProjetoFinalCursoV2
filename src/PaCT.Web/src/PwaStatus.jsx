import styles from './PwaStatus.module.css'
import { useEffect, useRef, useState } from 'react'
import { readPublicBuild } from './publicStorage'

const buildVersion = import.meta.env.PACT_BUILD_ID

export default function PwaStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [waiting, setWaiting] = useState(null)
  const [error, setError] = useState('')
  const [metadata, setMetadata] = useState(null)
  const [reloadReady, setReloadReady] = useState(false)
  const dirtyForms = useRef(new Set())

  useEffect(() => {
    let current = true
    let registration
    const hadController = Boolean(navigator.serviceWorker?.controller)
    function hasDraft() { return [...dirtyForms.current].some(form => form.isConnected) }
    function changed(event) { const form = event.target.closest('form:not([data-allow-update])'); if (form) dirtyForms.current.add(form) }
    async function status() {
      setOnline(navigator.onLine)
      try { const saved = await readPublicBuild(); if (current) setMetadata(saved) } catch { if (current) setError('O armazenamento público offline não está disponível. A utilização online continua possível.') }
    }
    function install(event) { if (window.matchMedia('(min-width: 781px)').matches) { event.preventDefault(); setInstallPrompt(event) } }
    function installed() { setInstallPrompt(null) }
    function message(event) {
      if (event.data?.type === 'PACT_PAGE_VERSION') event.ports[0]?.postMessage({ version: buildVersion })
      if (event.data?.type === 'PACT_CHECK_UPDATE') event.ports[0]?.postMessage({ allow: !hasDraft() })
      if (event.data?.type === 'PACT_UPDATE_BLOCKED') setError('Guarda ou cancela as alterações nas janelas abertas antes de atualizar. Nenhum formulário foi recarregado.')
    }
    async function activated() {
      await status()
      if (hadController) {
        if (hasDraft()) setReloadReady(true)
        else window.location.reload()
      }
      navigator.serviceWorker.controller?.postMessage({ type: 'PACT_PAGE_READY' })
    }
    function update() { if (navigator.onLine && document.visibilityState === 'visible') registration?.update().catch(() => {}) }
    async function prepare() {
      if (!import.meta.env.PROD || !window.isSecureContext || !navigator.serviceWorker) return
      try {
        registration = !navigator.onLine ? await navigator.serviceWorker.getRegistration('/') :
          await navigator.serviceWorker.register('/service-worker.js', { scope: '/', updateViaCache: 'none' })
        if (!registration) { await status(); return }
        if (!current) return
        if (registration.waiting) setWaiting(registration.waiting)
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing
          worker?.addEventListener('statechange', () => {
            if (current && worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(registration.waiting)
            if (current && worker.state === 'redundant' && !navigator.serviceWorker.controller) setError('A preparação pública offline falhou. Mantém a ligação e volta a tentar quando não tiveres alterações por guardar.')
          })
        })
        await status()
        navigator.serviceWorker.controller?.postMessage({ type: 'PACT_PAGE_READY' })
      } catch { if (current) setError('Não foi possível preparar o modo público offline. Verifica a ligação e atualiza a página quando não tiveres alterações por guardar.') }
    }
    document.addEventListener('input', changed)
    document.addEventListener('change', changed)
    window.addEventListener('online', status); window.addEventListener('offline', status)
    window.addEventListener('beforeinstallprompt', install); window.addEventListener('appinstalled', installed)
    navigator.serviceWorker?.addEventListener('message', message)
    navigator.serviceWorker?.addEventListener('controllerchange', activated)
    document.addEventListener('visibilitychange', update)
    prepare()
    return () => {
      current = false
      document.removeEventListener('input', changed); document.removeEventListener('change', changed)
      window.removeEventListener('online', status); window.removeEventListener('offline', status)
      window.removeEventListener('beforeinstallprompt', install); window.removeEventListener('appinstalled', installed)
      navigator.serviceWorker?.removeEventListener('message', message); navigator.serviceWorker?.removeEventListener('controllerchange', activated)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  function refresh() {
    if ([...dirtyForms.current].some(form => form.isConnected)) { setError('Guarda ou cancela as alterações antes de atualizar.'); return }
    if (reloadReady) window.location.reload()
    else waiting?.postMessage({ type: 'PACT_ACTIVATE_UPDATE' })
  }
  if (online && !installPrompt && !waiting && !error && !reloadReady) return null
  return <aside className={styles.status} aria-label="Estado da aplicação">
    {!online && <div role="status"><strong>Sem ligação à rede.</strong> Rascunhos privados já desbloqueados podem continuar a ser editados neste aparelho. Depois de reabrir a aplicação, é necessário iniciar sessão online para os desbloquear. Fechos e outros envios não são executados automaticamente.{metadata?.cachedAt && <p>Recursos públicos preparados em {new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', dateStyle: 'short', timeStyle: 'short' }).format(new Date(metadata.cachedAt))}.</p>}</div>}
    {installPrompt && <button className="secondary" onClick={async () => { await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null) }}>Instalar PaCT</button>}
    {(waiting || reloadReady) && <div><button disabled={!online} onClick={refresh}>actualizar a pagina PaCT</button></div>}
    {error && <p role="alert" className="notice error">{error}</p>}
  </aside>
}
