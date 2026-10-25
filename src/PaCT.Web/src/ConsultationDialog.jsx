import { useEffect, useRef } from 'react'
import styles from './ConsultationDialog.module.css'

export default function ConsultationDialog({ children, onClose, disabled, label = 'Detalhe da consulta', compact = false, className = '' }) {
  const dialog = useRef(null)
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => element.close()
  }, [])
  return <dialog ref={dialog} aria-label={label} className={`consultation-dialog ${styles.dialog} ${className}`} onCancel={event => { event.preventDefault(); if (!disabled) onClose() }}>
    <button type="button" aria-label="Fechar" className={compact ? styles.compactClose : 'secondary'} disabled={disabled} onClick={onClose}>{compact ? '×' : 'Fechar'}</button>
    {children}
  </dialog>
}
