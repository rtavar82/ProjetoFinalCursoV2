import ActionButton from './ActionButton'
import AppLayout from './AppLayout'
import AuthPage from './AuthPage'
import Heading from './Heading'
import styles from './AuthPage.module.css'

export default function PublicOpening({ onNavigate, visualTheme, onThemeChange }) {
  return <AppLayout page="PublicOpening" presentation="access" onHome={() => onNavigate('PublicOpening')} visualTheme={visualTheme} onThemeChange={onThemeChange}>
    <AuthPage presentation="access" introduction={<>
      <Heading level={1}>Um espaço para ti.</Heading>
      <img src="/borboleta.png" width="378" height="330" alt="" />
    </>}>
      <div className={styles.openingActions}>
        <ActionButton onClick={() => onNavigate('SignIn')}>Entrar na tua área</ActionButton>
        <ActionButton variant="text" onClick={() => onNavigate('PublicHome')}>Conhecer o PaCT</ActionButton>
      </div>
    </AuthPage>
  </AppLayout>
}
