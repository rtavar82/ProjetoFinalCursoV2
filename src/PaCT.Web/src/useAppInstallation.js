import { useSyncExternalStore } from 'react'

let prompt = null
const listeners = new Set()
const emit = () => listeners.forEach(listener => listener())
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event; emit() })
  window.addEventListener('appinstalled', () => { prompt = null; emit() })
  window.matchMedia('(display-mode: standalone)').addEventListener('change', emit)
}
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
const snapshot = () => standalone() ? 'installed' : prompt ? 'available' : 'manual'
export default function useAppInstallation() {
  const state = useSyncExternalStore(subscribe, snapshot, () => 'manual')
  async function install() {
    const pending = prompt
    if (!pending) return
    prompt = null
    emit()
    try { await pending.prompt(); return await pending.userChoice }
    finally { emit() }
  }
  return { state, install }
}