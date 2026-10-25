import styles from './AuthPage.module.css'

export default function AuthPage({ introduction, busy, onBack, children }) {
  return <div className={styles.page}><aside className={styles.introduction}>{introduction}</aside><section className={`${styles.panel} ${onBack ? styles.panelWithBack : ''}`} aria-busy={busy}>
    {onBack && <button type="button" className={styles.backLink} disabled={busy} onClick={onBack}>← Voltar ao início</button>}
    {children}
  </section></div>
}
