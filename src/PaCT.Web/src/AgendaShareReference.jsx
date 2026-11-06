import { useState } from 'react'
import ActionButton from './ActionButton'
import { showSuccess } from './actionNotices'
import styles from './AgendaShareReference.module.css'

export default function AgendaShareReference({ reference }) {
  const [error, setError] = useState('')
  async function copy() {
    setError('')
    try {
      await navigator.clipboard.writeText(reference)
      showSuccess('Referência copiada.')
    } catch { setError('Seleciona e copia a referência apresentada.') }
  }
  return <div className={styles.actions}>
    <small>Referência {reference}</small>
    <ActionButton variant="text" onClick={copy}>Copiar para partilhar</ActionButton>
    {error && <small role="alert">{error}</small>}
  </div>
}