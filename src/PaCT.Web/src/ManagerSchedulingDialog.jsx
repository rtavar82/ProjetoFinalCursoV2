import { useEffect, useId, useRef } from 'react'
import DialogHeader from './DialogHeader'
import styles from './ManagerScheduling.module.css'

export default function ManagerSchedulingDialog({ title, label, disabled, onClose, children }) {
  const dialog = useRef(null), heading = useId()
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close() }, [])
  return <dialog ref={dialog} className={`ui-dialog ${styles.dialog}`} aria-label={label} aria-labelledby={label ? undefined : heading} onCancel={event => { event.preventDefault(); if (!disabled) onClose() }}>
    <DialogHeader title={title} titleId={heading} className={styles.header} disabled={disabled} onClose={onClose} />
    <div className={styles.body}>{children}</div>
  </dialog>
}
