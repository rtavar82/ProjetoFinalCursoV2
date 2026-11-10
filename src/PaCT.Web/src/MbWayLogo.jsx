import logo from './assets/mb-way.png'
import styles from './MbWayLogo.module.css'

export default function MbWayLogo({ compact = false, decorative = false }) {
  return <img className={compact ? styles.compact : styles.logo} src={logo} alt={decorative ? '' : 'MB WAY'} width="292" height="143" />
}
