import { useRef } from 'react'
import styles from './AppLayout.module.css'
import PageErrorBoundary from './PageErrorBoundary'
import { PrivacyLink } from './PrivacyProvider'
import { visualThemes } from './visualTheme'

const footerTitle = 'PaCT — Plataforma de Acompanhamento entre Clientes e Terapeuta'

export default function AppLayout({ authenticated = false, publicNavigation = false, onHome, navigation, session, alerts, page, children, visualTheme, onThemeChange, presentation, ...props }) {
  const main = useRef(null), brand = useRef(null)
  const sharedPresentation = page === 'PublicHome' || page === 'PublicTestimonials'
    || (visualTheme && ['Agenda', 'Sharing'].includes(page))

  function jump(event, target, block) {
    event.preventDefault()
    target.current?.focus({ preventScroll: true })
    target.current?.scrollIntoView({ block })
  }
  function backToTop(event) {
    event.preventDefault()
    brand.current?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }
  return <div {...props} data-ui="page-layout" data-page={page} data-visual-theme={visualTheme} data-presentation={presentation}
    className={`${styles.shell} ${authenticated ? styles.authenticated : ''} ${publicNavigation ? styles.publicNavigation : ''} ${sharedPresentation ? styles.sharedPresentation : ''}`}>
    <a className={styles.skip} href="#page-content" onClick={event => jump(event, main, 'start')}>Ir para o conteúdo</a>
    <header className={styles.header}>
      <a id="pact-top" ref={brand} className={styles.brand} data-typography="brand" href="/" onClick={onHome ? event => { event.preventDefault(); onHome() } : undefined} aria-label="PaCT — início"><img src="/borboleta.png" alt="" width="378" height="330" /><span>PaCT<small>O teu espaço de acompanhamento</small></span></a>
      {navigation}
      {session ? <div className={styles.session}>{session}</div> : !presentation && <span className={styles.tagline}>O teu espaço de acompanhamento</span>}
    </header>
    <main id="page-content" ref={main} data-ui="page" className={styles.main} tabIndex="-1"><PageErrorBoundary page={page}>{alerts && <div className={styles.alerts}>{alerts}</div>}{children}</PageErrorBoundary></main>
    <footer className={styles.footer}>
      {visualTheme
        ? <a className={styles.footerTitle} href="#pact-top" onClick={backToTop}>{footerTitle}</a>
        : <span className={styles.footerTitle}>{footerTitle}</span>}
      {visualTheme && onThemeChange && <label className={styles.theme}><span id="pact-theme-label">Tema</span><select aria-labelledby="pact-theme-label" value={visualTheme} onChange={event => onThemeChange(event.target.value)}>
        {Object.entries(visualThemes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>}
      <PrivacyLink />
    </footer>
  </div>
}
