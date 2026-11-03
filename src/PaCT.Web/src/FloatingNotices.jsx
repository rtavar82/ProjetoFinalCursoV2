import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FLOATING_NOTICE } from './actionNotices'
import styles from './FloatingNotices.module.css'

export default function FloatingNotices() {
  const [notice, setNotice] = useState(null)
  const popup = useRef(null)
  useEffect(() => {
    let timer, currentKind
    const confirmed = new Set()
    function display(next) {
      window.clearTimeout(timer)
      currentKind = next?.kind
      setNotice(next)
      if (next) timer = window.setTimeout(() => {
        timer = null
        currentKind = null; setNotice(null)
      }, 3000)
    }
    function receive(event) {
      const next = event.detail
      if (next?.dismissSuccess) { if (currentKind === 'success') display(null); return }
      if (!next?.message || !['success', 'warning'].includes(next.kind)) return
      if (next.kind === 'success' && next.key) {
        if (confirmed.has(next.key)) return
        confirmed.add(next.key)
        if (confirmed.size > 100) confirmed.delete(confirmed.values().next().value)
      }
      display(next)
    }
    window.addEventListener(FLOATING_NOTICE, receive)
    return () => { window.removeEventListener(FLOATING_NOTICE, receive); window.clearTimeout(timer) }
  }, [])
  useEffect(() => {
    const element = popup.current
    function raise() { element.hidePopover?.(); if (notice) element.showPopover?.() }
    raise()
    // A dialog opened after the confirmation must not cover the shared notice.
    const observer = new MutationObserver(changes => {
      if (changes.some(change => change.target.matches?.('dialog[open]') || [...change.addedNodes].some(node => node.nodeType === 1 && (node.matches('dialog[open]') || node.querySelector('dialog[open]'))))) raise()
    })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
    return () => { observer.disconnect(); element.hidePopover?.() }
  }, [notice])
  return createPortal(<div ref={popup} popover="manual" hidden={!notice} data-kind={notice?.kind} className={styles.popup} role="status" aria-live="polite" aria-atomic="true">{notice?.message}</div>, document.body)
}
