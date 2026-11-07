import { useState } from 'react'
import ActionButton from './ActionButton'
import { showSuccess } from './actionNotices'
import styles from './AgendaShareReference.module.css'

export default function AgendaShareReference({ reference, label = 'Copiar para partilhar', showReference = true }) {
  const [error, setError] = useState('')
  async function copy() {
    setError('')
    try {
      await navigator.clipboard.writeText(reference)
      showSuccess('Referência copiada.')
    } catch { setError(showReference ? 'Seleciona e copia a referência apresentada.' : 'Não foi possível copiar a referência. Tenta novamente.') }
  }
  return <div className={showReference ? styles.actions : `${styles.actions} ${styles.compact}`}>
    {showReference && <small>Referência {reference}</small>}
    <ActionButton variant="text" onClick={copy}>{label}</ActionButton>
    {error && <small role="alert">{error}</small>}
  </div>
}
