import { useEffect, useRef, useState } from 'react'
import { refreshOpenedView } from './liveUpdates'
import { STALE_CONTENT } from './readFreshness'
import styles from './ContentFreshness.module.css'

export default function ContentFreshness() {
  const [visible, setVisible] = useState(false)
  const popup = useRef(null)
  useEffect(() => {
    let dismissal, navigation
    function warn() {
      if (dismissal) return
      setVisible(true)
      dismissal = window.setTimeout(() => { dismissal = null; setVisible(false) }, 3000)
    }
    function opened() {
      if (navigation) return
      navigation = window.setTimeout(() => {
        navigation = null
        if (!navigator.onLine) warn()
        refreshOpenedView()
      }, 0)
    }
    function navigate(event) {
      const control = event.target.closest?.('nav button, nav a, [role="tab"], a[href^="#"]')
      if (control && !control.disabled && control.getAttribute('aria-disabled') !== 'true') opened()
    }
    const observer = new MutationObserver(changes => {
      if (changes.some(change => change.type === 'attributes'
        ? change.attributeName === 'open' && change.target.open
          || change.attributeName === 'hidden' && !change.target.hidden
          || change.attributeName === 'aria-expanded' && change.target.getAttribute('aria-expanded') === 'true'
        : [...change.addedNodes].some(node => node.nodeType === 1 && (node.matches('h1, dialog[open]') || node.querySelector('h1, dialog[open]'))))) opened()
    })
    observer.observe(document.getElementById('root'), { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden', 'aria-expanded'] })
    document.addEventListener('click', navigate, true)
    window.addEventListener(STALE_CONTENT, warn)
    window.addEventListener('offline', warn)
    window.addEventListener('hashchange', opened)
    window.addEventListener('popstate', opened)
    if (!navigator.onLine) warn()
    return () => {
      observer.disconnect()
      document.removeEventListener('click', navigate, true)
      window.removeEventListener(STALE_CONTENT, warn)
      window.removeEventListener('offline', warn)
      window.removeEventListener('hashchange', opened)
      window.removeEventListener('popstate', opened)
      window.clearTimeout(dismissal); window.clearTimeout(navigation)
    }
  }, [])
  useEffect(() => {
    if (visible) popup.current?.showPopover?.()
    else popup.current?.hidePopover?.()
  }, [visible])
  return <div ref={popup} popover="manual" hidden={!visible} className={styles.popup} role="status" aria-live="polite" aria-atomic="true">
    Não foi possível atualizar. O conteúdo pode estar desatualizado.
  </div>
}
