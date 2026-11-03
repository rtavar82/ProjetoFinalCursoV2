import { useCallback, useEffect, useId, useRef } from 'react'
import { apiRequest } from './identityApi'
import ClientDataSummary from './ClientDataSummary'
import useLiveResource from './useLiveResource'
import DialogHeader from './DialogHeader'

export default function ClientComparison({ personId, onClose }) {
  const dialog = useRef(null)
  const titleId = useId()
  const read = useCallback(() => apiRequest('clients/' + personId), [personId])
  const { data: client, error } = useLiveResource('clients', 'comparison:' + personId, read)
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => element.close()
  }, [])
  return <dialog ref={dialog} className="ui-dialog client-comparison" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }}>
    <DialogHeader title="Ficha existente — comparação" titleId={titleId} onClose={onClose} closeLabel="Fechar comparação e voltar à ocorrência" />
    <p>Consulta os dados antes de decidir. Abrir esta ficha não associa perfis nem altera informação.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!client && !error && <p role="status">A carregar a ficha…</p>}
    {client && <ClientDataSummary data={client.data} hasAccount={client.hasAccount} />}
  </dialog>
}
