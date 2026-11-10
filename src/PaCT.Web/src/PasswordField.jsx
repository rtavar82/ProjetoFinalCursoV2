import { useEffect, useId, useRef, useState } from 'react'
import AppIcon from './AppIcon'
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
        <AppIcon name={visible ? 'eyeOff' : 'eye'} />
      </button>
    </div>
  </div>
}
