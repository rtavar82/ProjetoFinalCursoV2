import { useEffect, useId, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import ClientDataSummary from './ClientDataSummary'

export default function ClientComparison({ personId, onClose }) {
  const dialog = useRef(null)
  const titleId = useId()
  const [client, setClient] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => element.close()
  }, [])
  useEffect(() => {
    let current = true
    apiRequest('clients/' + personId).then(result => { if (current) setClient(result) }).catch(failure => { if (current) setError(failure.message) })
    return () => { current = false }
  }, [personId])
  return <dialog ref={dialog} className="client-comparison" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }}>
    <h2 id={titleId}>Ficha existente — comparação</h2>
    <p>Consulta os dados antes de decidir. Abrir esta ficha não associa perfis nem altera informação.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!client && !error && <p role="status">A carregar a ficha…</p>}
    {client && <ClientDataSummary data={client.data} hasAccount={client.hasAccount} />}
    <button type="button" className="secondary" onClick={onClose}>Fechar comparação e voltar à ocorrência</button>
  </dialog>
}
