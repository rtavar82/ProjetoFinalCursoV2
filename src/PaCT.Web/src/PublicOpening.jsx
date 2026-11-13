import ActionButton from './ActionButton'
import AppLayout from './AppLayout'
import AuthPage from './AuthPage'
import Heading from './Heading'
import BrandButterfly from './BrandButterfly'
import styles from './AuthPage.module.css'

export default function PublicOpening({ onNavigate, onEnter }) {
  return <AppLayout page="PublicOpening" presentation="access" onHome={() => onNavigate('PublicOpening')}>
    <AuthPage presentation="access" introduction={<>
      <Heading level={1}>Um espaço para ti.</Heading>
      <span className={styles.openingButterfly} data-ui="opening-butterfly-slot" aria-hidden="true"><BrandButterfly /></span>
    </>}>
      <div className={styles.openingActions}>
        <ActionButton onClick={onEnter}>Entrar na tua área</ActionButton>
        <ActionButton variant="text" onClick={() => onNavigate('PublicHome')}>Conhecer o PaCT</ActionButton>
      </div>
    </AuthPage>
  </AppLayout>
}
