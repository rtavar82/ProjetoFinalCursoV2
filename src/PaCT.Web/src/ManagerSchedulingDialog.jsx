import { useEffect, useId, useRef } from 'react'
import styles from './ManagerScheduling.module.css'

export default function ManagerSchedulingDialog({ title, disabled, onClose, children }) {
  const dialog = useRef(null), heading = useId()
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close() }, [])
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={heading} onCancel={event => { event.preventDefault(); if (!disabled) onClose() }}>
    <header className={styles.header}><h2 id={heading}>{title}</h2><button type="button" className="text-button" aria-label="Fechar" disabled={disabled} onClick={onClose}>×</button></header>
    <div className={styles.body}>{children}</div>
  </dialog>
}
