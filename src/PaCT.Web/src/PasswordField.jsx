import { useEffect, useId, useRef, useState } from 'react'
import styles from './PasswordField.module.css'

export default function PasswordField({ label, className = '', revealLabel = 'palavra-passe', ...inputProps }) {
  const id = useId()
  const input = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const form = input.current?.form
    const conceal = () => setVisible(false)
    const visibility = () => { if (document.hidden) conceal() }
    form?.addEventListener('reset', conceal)
    document.addEventListener('visibilitychange', visibility)
    return () => { form?.removeEventListener('reset', conceal); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  return <div className={`${styles.field} ${className}`}>
    <label htmlFor={id}>{label}</label>
    <div className={styles.control}>
      <input {...inputProps} ref={input} id={id} type={visible ? 'text' : 'password'} spellCheck={false} autoCapitalize="none" />
      <button className={styles.toggle} type="button" disabled={inputProps.disabled} aria-controls={id} aria-pressed={visible}
        aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${revealLabel}`} onClick={() => setVisible(value => !value)}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
          {visible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </div>
  </div>
}
