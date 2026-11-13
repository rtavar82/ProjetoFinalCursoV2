import { useState } from 'react'
import InformationCard from './InformationCard'
import ActionButton from './ActionButton'
import DisclosureSummary from './DisclosureSummary'
import useAppInstallation from './useAppInstallation'

export default function AppInstallationCard() {
  const { state, install } = useAppInstallation()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function start() {
    setBusy(true)
    setMessage('')
    try {
      const result = await install()
      if (result?.outcome === 'dismissed') setMessage('Instalação cancelada. Podes voltar a tentar pelo menu do navegador.')
    } catch { setMessage('Não foi possível iniciar a instalação. Usa a opção de instalação no menu do navegador.') }
    finally { setBusy(false) }
  }
  return <InformationCard title="Instalar a aplicação" cardId="client-app-installation">
    {state === 'installed' ? <p>Estás a utilizar a aplicação instalada.</p> : <>
      <p>Adiciona a aplicação ao teu telemóvel ou computador para acederes diretamente pelo seu ícone.</p>
      {state === 'available' ? <ActionButton disabled={busy} onClick={start}>{busy ? 'A preparar…' : 'Instalar a aplicação'}</ActionButton> : <details>
        <DisclosureSummary>Como instalar a aplicação</DisclosureSummary>
        <p>No Android ou computador, abre o menu do navegador e procura «Instalar aplicação» ou «Adicionar ao ecrã principal».</p>
        <p>No iPhone ou iPad, abre este site no Safari, toca em Partilhar e escolhe «Adicionar ao ecrã principal».</p>
        <p>Se a opção não aparecer, podes continuar a usar o site neste navegador.</p>
      </details>}
    </>}
    {message && <p role="status">{message}</p>}
  </InformationCard>
}