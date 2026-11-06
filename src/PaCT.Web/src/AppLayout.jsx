import styles from './AppLayout.module.css'
import AppIcon from './AppIcon'
import { PrivacyLink } from './PrivacyProvider'

export default function AppLayout({ authenticated = false, publicNavigation = false, onHome, navigation, session, alerts, children, ...props }) {
  return <div {...props} data-ui="page-layout" className={`${styles.shell} ${authenticated ? styles.authenticated : ''} ${publicNavigation ? styles.publicNavigation : ''}`}>
    <a className={styles.skip} href="#page-content">Ir para o conteúdo</a>
    <header className={styles.header}>
      <a className={styles.brand} data-typography="brand" href="/" onClick={onHome ? event => { event.preventDefault(); onHome() } : undefined} aria-label="PaCT — início"><AppIcon name="leaf" /><span>PaCT<small>O teu espaço de acompanhamento</small></span></a>
      {navigation}
      {session ? <div className={styles.session}>{session}</div> : <span className={styles.tagline}>O teu espaço de acompanhamento</span>}
    </header>
    <main id="page-content" data-ui="page" className={styles.main} tabIndex="-1">{alerts && <div className={styles.alerts}>{alerts}</div>}{children}</main>
    <footer className={styles.footer}>PaCT · O teu espaço de acompanhamento <PrivacyLink /></footer>
  </div>
}
