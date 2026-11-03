import { useEffect, useRef } from 'react'
import DialogHeader from './DialogHeader'
import styles from './ConsultationDialog.module.css'

export default function ConsultationDialog({ children, title, titleRef, onClose, disabled, label = 'Detalhe da consulta', className = '' }) {
  const dialog = useRef(null)
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => element.close()
  }, [])
  return <dialog ref={dialog} aria-label={label} className={`ui-dialog consultation-dialog ${styles.dialog} ${className}`} onCancel={event => { event.preventDefault(); if (!disabled) onClose() }}>
    <DialogHeader title={title} titleRef={titleRef} className={styles.header} disabled={disabled} onClose={onClose} />
    <div className={styles.body}>{children}</div>
  </dialog>
}
