import { useRef } from 'react'
import styles from './SearchInput.module.css'

export default function SearchInput({ value, onChange, onClear, clearLabel = 'Limpar pesquisa', showClear = !!value, ref, disabled, ...props }) {
  const local = useRef(null)
  return <div className={styles.input}><input {...props} ref={ref || local} value={value} disabled={disabled} onChange={onChange} />
    {showClear && <button type="button" className={styles.clear} aria-label={clearLabel} title={clearLabel} disabled={disabled} onClick={() => { onClear(); (ref || local).current?.focus() }}>×</button>}
  </div>
}
