import { useLayoutEffect, useRef } from 'react'
import AdaptiveSelect from './AdaptiveSelect'
import { useVisualTheme } from './visualThemeContext'
import { PrivacyLink } from './PrivacyProvider'
import { visualThemes } from './visualTheme'
import styles from './AppFooter.module.css'

const footerTitle = 'PaCT — Plataforma de Acompanhamento entre Clientes e Terapeuta'

export default function AppFooter({ onBackToTop, hasFixedNavigation, access }) {
  const { theme, changeTheme } = useVisualTheme()
  const footer = useRef(null)
  useLayoutEffect(() => {
    const element = footer.current, root = document.documentElement
    const layout = element.closest('[data-ui="page-layout"]'), header = layout?.querySelector('header')
    const banners = document.querySelector('[data-ui="app-banners"]')
    let frame
    function measure() {
      const bounds = element.getBoundingClientRect(), top = header?.getBoundingClientRect()
      const visible = Math.max(0, Math.min(bounds.height, innerHeight - bounds.top))
      const navigation = hasFixedNavigation && innerWidth < 1080
        ? parseFloat(getComputedStyle(layout).getPropertyValue('--bottom-navigation-space')) || 0 : 0
      root.style.setProperty('--footer-overlay-clearance', Math.max(visible, navigation) + 'px')
      root.style.setProperty('--header-overlay-clearance', top && top.width >= innerWidth - 1 ? Math.max(0, top.bottom) + 'px' : '0px')
    }
    function schedule() {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => { frame = undefined; measure() })
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    if (header) observer.observe(header)
    if (banners) observer.observe(banners)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(frame)
      root.style.removeProperty('--footer-overlay-clearance')
      root.style.removeProperty('--header-overlay-clearance')
    }
  }, [hasFixedNavigation])
  return <footer ref={footer} data-ui="app-footer" className={styles.footer}
    data-fixed-navigation={hasFixedNavigation ? '' : undefined} data-access={access ? '' : undefined}>
    <div className={styles.content}>
      <a className={styles.brand} href="#pact-top" onClick={onBackToTop}>{footerTitle}</a>
      <label className={styles.theme}>
        <span>Tema</span>
        <AdaptiveSelect value={theme} onChange={event => changeTheme(event.target.value)}>
          {Object.entries(visualThemes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </AdaptiveSelect>
      </label>
      <PrivacyLink />
    </div>
  </footer>
}
