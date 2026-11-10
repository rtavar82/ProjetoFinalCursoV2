import styles from './AuthPage.module.css'

export default function AuthPage({ introduction, busy, onBack, children, presentation }) {
  return <div className={`${styles.page} ${presentation === 'access' ? styles.access : ''}`}><aside className={styles.introduction}>{introduction}</aside>
    <section className={`${presentation ? '' : 'ui-card'} ${styles.panel} ${onBack ? styles.panelWithBack : ''} ${presentation === 'step' ? styles.step : ''}`} aria-busy={busy}>
    {onBack && <button type="button" className={styles.backLink} disabled={busy} onClick={onBack}>← Voltar ao início</button>}
    {children}
  </section></div>
}
