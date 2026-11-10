import { PrivacyLink } from './PrivacyProvider'
import { visualThemes } from './visualTheme'
import styles from './AppFooter.module.css'

const footerTitle = 'PaCT — Plataforma de Acompanhamento entre Clientes e Terapeuta'

export default function AppFooter({ visualTheme, onThemeChange, onBackToTop, hasFixedNavigation, access }) {
  return <footer data-ui="app-footer" data-visual-theme={visualTheme} className={styles.footer}
    data-fixed-navigation={hasFixedNavigation ? '' : undefined} data-access={access ? '' : undefined}>
    <div className={styles.content}>
      <a className={styles.brand} href="#pact-top" onClick={onBackToTop}>{footerTitle}</a>
      <label className={styles.theme}>
        <span>Tema</span>
        <select value={visualTheme} onChange={event => onThemeChange(event.target.value)}>
          {Object.entries(visualThemes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <PrivacyLink />
    </div>
  </footer>
}
