import { useRef } from 'react'
import styles from './AppLayout.module.css'
import PageErrorBoundary from './PageErrorBoundary'
import AppFooter from './AppFooter'
import Signature from './Signature'
import { PageIdentityContext } from './pageIdentityContext'

export default function AppLayout({ authenticated = false, publicNavigation = false, onHome, navigation, session, sessionName, sessionRole, alerts, page, children, themedLayout = true, presentation, ...props }) {
  const main = useRef(null), brand = useRef(null)
  const hasThemedLayout = themedLayout
  const hasSidebar = authenticated || publicNavigation
  const signatureBrand = page !== 'PublicOpening'
  const sharedPresentation = page === 'PublicHome' || page === 'PublicTestimonials'
    || (hasThemedLayout && (['Agenda', 'Sharing', 'Consultations', 'Finance', 'Clients'].includes(page) || page === 'Account' && sessionRole))

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
  const header = <header className={styles.header}>
      <a id="pact-top" ref={brand} className={styles.brand} data-typography="brand" href="/" onClick={onHome ? event => { event.preventDefault(); onHome() } : undefined} aria-label="PaCT — início">{!signatureBrand && <img src="/borboleta.png" alt="" width="378" height="330" />}<span>{signatureBrand ? <Signature className={styles.brandSignature} data-ui="brand-signature" /> : 'PaCT'}<small>O teu espaço de acompanhamento</small></span></a>
      {navigation}
      {session ? <div className={styles.session}>
        {sessionName && <span className={styles.sessionName} title={sessionName}>{sessionName}</span>}
        {sessionRole && <span className={styles.sessionRole}>{sessionRole}</span>}
        {session}
      </div> : !presentation && <span className={styles.tagline}>O teu espaço de acompanhamento</span>}
    </header>

  return <div {...props} data-ui="page-layout" data-page={page} data-presentation={presentation}
    className={`${styles.shell} ${hasThemedLayout ? styles.themedLayout : ''} ${hasSidebar ? styles.withSidebar : ''} ${authenticated ? styles.authenticated : ''} ${publicNavigation ? styles.publicNavigation : ''} ${sharedPresentation ? styles.sharedPresentation : ''}`}>
    <a className={styles.skip} href="#page-content" onClick={event => jump(event, main, 'start')}>Ir para o conteúdo</a>
    {hasSidebar ? <div className={styles.sidebar}>{header}</div> : header}
    <main id="page-content" ref={main} data-ui="page" className={styles.main} tabIndex="-1"><PageIdentityContext value={signatureBrand}><PageErrorBoundary page={page}>{alerts && <div className={styles.alerts}>{alerts}</div>}{children}</PageErrorBoundary></PageIdentityContext></main>
    <AppFooter onBackToTop={backToTop}
      hasFixedNavigation={authenticated && !!navigation} access={presentation === 'access'} />
  </div>
}
