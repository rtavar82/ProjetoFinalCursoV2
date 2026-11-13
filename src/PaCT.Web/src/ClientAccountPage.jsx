import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import AccountSecuritySettings from './AccountSecuritySettings'
import AppInstallationCard from './AppInstallationCard'
import ActionButton from './ActionButton'
import ClientPrivacyCard from './ClientPrivacyCard'
import CloseAccount from './CloseAccount'
import FinancialSalesPanel from './FinancialSalesPanel'
import Heading from './Heading'
import InformationCard from './InformationCard'
import PasskeySettings from './PasskeySettings'
import SessionPacksPanel from './SessionPacksPanel'
import { apiRequest, request } from './identityApi'
import { usePrivacy } from './privacyContext'
import useLiveResource from './useLiveResource'
import styles from './ClientAccountPage.module.css'

const areas = [
  { id: 'activity', label: 'Sessões e compras', entries: [
    ['available', 'Packs com sessões'],
    ['unpaid', 'Packs por pagar'],
    ['purchases', 'As minhas compras'],
    ['installation', 'Instalar a aplicação'],
  ] },
  { id: 'privacy', label: 'Privacidade', entries: [
    ['policy', 'Política de privacidade'],
    ['notifications', 'Notificações'],
    ['history', 'Histórico das minhas escolhas'],
  ] },
  { id: 'security', label: 'Segurança', entries: [
    ['passkeys', 'Passkeys'],
    ['password', 'Palavra-passe'],
    ['google', 'Conta Google'],
    ['browser', 'Navegador deste dispositivo'],
    ['closure', 'Encerrar conta'],
  ] },
]

function countLabel(total, singular, plural, fallback) {
  return Number.isInteger(total) ? `${total} ${total === 1 ? singular : plural}` : fallback
}

const readPurchases = signal => apiRequest('finance/sales?page=1', undefined, { signal })
const readGoogle = () => request('google/status')

function usePackCount(scope, enabled) {
  const read = useCallback(signal => apiRequest(`consultations/packs?scope=${scope}&page=1`, undefined, { signal }), [scope])
  return useLiveResource('packs', `${scope}:1:`, read, enabled).data?.total
}

export default function ClientAccountPage({ profile, busy, perform, notify, guard, onPasskeyUpdated, onSecuritySignedOut, onAccountClosed, onForgetBrowser, packEntry }) {
  const [areaId, setAreaId] = useState('activity')
  const [detail, setDetail] = useState(packEntry?.id ? 'available' : null)
  const [seenPack, setSeenPack] = useState(packEntry)
  const heading = useRef(null)
  const returnPosition = useRef(null)
  const focusOnNavigation = useRef(false)

  if (seenPack !== packEntry) {
    setSeenPack(packEntry)
    if (packEntry?.id) {
      setAreaId('activity')
      setDetail('available')
    }
  }

  const area = areas.find(item => item.id === areaId)
  const detailTitle = area.entries.find(([id]) => id === detail)?.[1]
  const activityOverview = areaId === 'activity' && !detail
  const available = usePackCount('Available', activityOverview)
  const unpaid = usePackCount('Unpaid', activityOverview)
  const purchases = useLiveResource('sales', 'page=1', readPurchases, activityOverview).data?.total
  const google = useLiveResource('accountSecurity', 'google-status', readGoogle, areaId === 'security' && !detail).data
  const privacy = usePrivacy()
  const statuses = {
    available: countLabel(available, 'pack com sessões', 'packs com sessões', 'Sessões disponíveis nos teus packs.'),
    unpaid: countLabel(unpaid, 'pack por pagar', 'packs por pagar', 'Packs com pagamento pendente.'),
    installation: 'Adiciona a aplicação ao teu telemóvel ou computador.',
    purchases: countLabel(purchases, 'compra registada', 'compras registadas', 'Histórico de compras e recebimentos.'),
    policy: privacy?.policy && privacy.choices.data
      ? `Versão ${privacy.policy.version} · ${privacy.reading?.accepted && privacy.reading.version === privacy.policy.version ? 'Leitura confirmada' : 'Leitura por confirmar'}`
      : 'Consulta a política de privacidade em vigor.',
    notifications: privacy?.policy && privacy.choices.data
      ? (privacy.push?.accepted ? 'Notificações autorizadas na conta.' : 'Notificações por autorizar na conta.')
      : 'Gere a autorização na conta e a ativação neste dispositivo.',
    history: 'Consulta o registo das tuas escolhas de privacidade.',
    passkeys: 'Confirma a tua identidade com a impressão digital, o rosto ou o PIN do dispositivo, depois da palavra-passe.',
    password: 'Pede um link para alterar a palavra-passe.',
    google: google?.linked ? 'Conta Google associada.' : google?.enabled ? 'Conta Google por associar.' : 'Consulta as opções de entrada com Google.',
    browser: 'Gere a dispensa da confirmação adicional durante 30 dias neste navegador.',
    closure: 'Consulta as condições de encerramento da conta.',
  }

  useLayoutEffect(() => {
    if (!focusOnNavigation.current) return
    focusOnNavigation.current = false
    const previous = !detail && returnPosition.current
    const trigger = previous && document.getElementById(previous.id)
    if (trigger) {
      trigger.focus({ preventScroll: true })
      window.scrollTo(0, previous.y)
    } else {
      heading.current?.focus()
    }
  }, [areaId, detail])

  useLayoutEffect(() => {
    if (packEntry?.id) returnPosition.current = null
  }, [packEntry])

  function changeArea(id) {
    if (id === areaId) return
    guard(() => {
      returnPosition.current = null
      setAreaId(id)
      setDetail(null)
    })
  }

  function openDetail(id, event) {
    const position = { id: event.currentTarget.id, y: window.scrollY }
    guard(() => {
      returnPosition.current = position
      focusOnNavigation.current = true
      setDetail(id)
    })
  }

  function closeDetail() {
    guard(() => {
      focusOnNavigation.current = true
      setDetail(null)
    })
  }

  return <section aria-label="Definições da conta">
    <nav className={styles.menu} aria-label="Áreas da conta">
      {areas.map(item => <ActionButton key={item.id} variant={item.id === areaId ? 'primary' : 'secondary'} aria-current={item.id === areaId ? 'true' : undefined} disabled={busy} onClick={() => changeArea(item.id)}>{item.label}</ActionButton>)}
    </nav>


    <div hidden={!!detail}>
      <Heading level={2} ref={detail ? undefined : heading} tabIndex={-1}>{area.label}</Heading>
      <div className={styles.entries}>
        {area.entries.map(([id, title]) => <InformationCard key={id} as="article" cardId={`account-option-${id}`}>
          <div className={styles.entry}>
            <div>
              <Heading level={3} appearance="card-title">{title}</Heading>
              <p>{statuses[id]}</p>
            </div>
            <ActionButton id={`account-option-${id}-open`} variant="tinted" aria-label={`Ver detalhe de ${title}`} disabled={busy} onClick={event => openDetail(id, event)}>Ver detalhe</ActionButton>
          </div>
        </InformationCard>)}
      </div>
    </div>

    <div className={styles.detail} hidden={!detail}>
      {detail && <header className={styles.detailHeader}>
        <ActionButton variant="text" disabled={busy} onClick={closeDetail}>Voltar à lista</ActionButton>
        <Heading level={2} ref={heading} tabIndex={-1}>{detailTitle}</Heading>
      </header>}
      {detail === 'installation' && <AppInstallationCard />}
      <div hidden={detail !== 'available'}>
        <SessionPacksPanel fixedScope="Available" inline inlineEntry={packEntry} enabled={detail === 'available'} disabled={busy} guard={guard} />
      </div>
      <div hidden={detail !== 'unpaid'}>
        <SessionPacksPanel fixedScope="Unpaid" inline enabled={detail === 'unpaid'} disabled={busy} guard={guard} />
      </div>
      <div hidden={detail !== 'purchases'}>
        <FinancialSalesPanel own inline enabled={detail === 'purchases'} disabled={busy} guard={guard} />
      </div>
      {detail && areaId !== 'activity' && <InformationCard cardId={`account-detail-${detail}`}>
        {areaId === 'privacy' && <ClientPrivacyCard key={detail} view={detail} />}
        {detail === 'passkeys' && <PasskeySettings inline enabled={profile.passkeyEnabled} busy={busy} perform={perform} onUpdated={onPasskeyUpdated} notify={notify} />}
        {['password', 'google'].includes(detail) && <AccountSecuritySettings key={detail} view={detail} busy={busy} perform={perform} notify={notify} guard={guard} onSignedOut={onSecuritySignedOut} />}
        {detail === 'browser' && <><p>Se escolheste reconhecer este navegador, podes entrar durante 30 dias sem repetir a confirmação adicional de segurança.</p><p>Ao retirar esse reconhecimento, a confirmação volta a ser pedida na próxima entrada. A sessão atual mantém-se aberta e a Passkey continua registada.</p><ActionButton variant="secondary" disabled={busy} onClick={onForgetBrowser}>Deixar de reconhecer este navegador</ActionButton></>}
        {detail === 'closure' && <CloseAccount inline busy={busy} perform={perform} guard={guard} onClosed={onAccountClosed} />}
      </InformationCard>}
    </div>
  </section>
}
