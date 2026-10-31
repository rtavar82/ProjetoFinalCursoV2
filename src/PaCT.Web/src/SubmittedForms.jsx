import { useEffect } from 'react'
import { contentUnavailable, reportStaleContent } from './readFreshness'
import { cancelSubmittedWrites, waitForConnection } from './submittedWrites'

const signature = form => JSON.stringify([...new FormData(form)].map(([key, value]) => [key, typeof value === 'string' ? value : [value.name, value.size, value.lastModified]]))

export default function SubmittedForms() {
  useEffect(() => {
    const pending = new Map(), resuming = new WeakSet()
    function cancel() { pending.clear(); cancelSubmittedWrites() }
    function edited(event) { const form = event.target.closest?.('form'); if (form) pending.delete(form) }
    function submit(event) {
      const form = event.target
      if (resuming.has(form)) { resuming.delete(form); return }
      if (!contentUnavailable()) return
      event.preventDefault(); event.stopImmediatePropagation()
      if (pending.has(form)) return
      reportStaleContent()
      const entry = { values: signature(form), submitter: event.submitter }
      pending.set(form, entry)
      void waitForConnection(() => form.isConnected && pending.get(form) === entry).then(() => {
        if (!form.isConnected || pending.get(form) !== entry || signature(form) !== entry.values) return
        pending.delete(form); resuming.add(form)
        const button = entry.submitter?.isConnected ? entry.submitter : null
        form.requestSubmit(button || undefined)
      }).catch(() => { if (pending.get(form) === entry) pending.delete(form) })
    }
    document.addEventListener('submit', submit, true)
    document.addEventListener('input', edited, true)
    document.addEventListener('change', edited, true)
    window.addEventListener('pagehide', cancel)
    window.addEventListener('pact:session-expired', cancel)
    return () => {
      document.removeEventListener('submit', submit, true)
      document.removeEventListener('input', edited, true)
      document.removeEventListener('change', edited, true)
      window.removeEventListener('pagehide', cancel)
      window.removeEventListener('pact:session-expired', cancel)
      cancel()
    }
  }, [])
  return null
}
