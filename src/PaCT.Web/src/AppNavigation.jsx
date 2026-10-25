import AppIcon from './AppIcon'
import styles from './AppNavigation.module.css'

export default function AppNavigation({ items, onNavigate }) {
  return <nav aria-label="Navegação principal" className={styles.navigation}>
    {items.map(item => <button key={item.id} type="button" className={styles.item} aria-current={item.active ? 'page' : undefined} onClick={() => onNavigate(item.id)}><AppIcon name={item.icon} /><span>{item.label}</span></button>)}
  </nav>
}
