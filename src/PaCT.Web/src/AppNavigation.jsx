import AppIcon from './AppIcon'
import { useLayoutEffect, useRef } from 'react'
import styles from './AppNavigation.module.css'

function revealSelected(element) {
  const selected = element.querySelector('[aria-current="page"]')
  if (!selected || element.scrollWidth <= element.clientWidth) return
  const bounds = element.getBoundingClientRect(), item = selected.getBoundingClientRect()
  if (item.left < bounds.left) element.scrollBy({ left: item.left - bounds.left })
  else if (item.right > bounds.right) element.scrollBy({ left: item.right - bounds.right })
}

export default function AppNavigation({ items, onNavigate }) {
  const navigation = useRef(null)
  const selected = items.find(item => item.active)?.id
  useLayoutEffect(() => {
    const element = navigation.current, shell = element.closest('[data-ui="page-layout"]')
    if (!shell) return
    function measure() {
      shell.style.setProperty('--bottom-navigation-space', getComputedStyle(element).position === 'fixed' ? `${element.getBoundingClientRect().height}px` : '0px')
      revealSelected(element)
    }
    const observer = new ResizeObserver(measure); observer.observe(element); window.addEventListener('resize', measure); measure()
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); shell.style.removeProperty('--bottom-navigation-space') }
  }, [])
  useLayoutEffect(() => { revealSelected(navigation.current) }, [selected])
  return <nav ref={navigation} aria-label="Navegação principal" className={`${styles.navigation} ${items.length > 6 ? styles.extended : ''}`}>
    {items.map(item => <button key={item.id} type="button" className={styles.item} aria-current={item.active ? 'page' : undefined} onClick={() => onNavigate(item.id)}><AppIcon name={item.icon} /><span>{item.label}</span></button>)}
  </nav>
}
