import AppIcon from './AppIcon'
import AppArrow from './AppArrow'
import { useLayoutEffect, useRef, useState } from 'react'
import styles from './AppNavigation.module.css'

function revealSelected(element) {
  const selected = element.querySelector('[aria-current="page"]')
  if (!selected || element.scrollWidth <= element.clientWidth) return
  const bounds = element.getBoundingClientRect(), item = selected.getBoundingClientRect()
  if (item.left < bounds.left) element.scrollBy({ left: item.left - bounds.left })
  else if (item.right > bounds.right) element.scrollBy({ left: item.right - bounds.right })
}

export default function AppNavigation({ items, onNavigate, publicNavigation = false }) {
  const navigation = useRef(null), track = useRef(null)
  const [edges, setEdges] = useState({ scrollable: false, previous: false, next: false })
  const extended = items.length > 6 && !publicNavigation
  const selected = items.find(item => item.active)?.id
  useLayoutEffect(() => {
    const element = navigation.current, list = track.current, shell = element.closest('[data-ui="page-layout"]')
    function updateEdges() {
      const maximum = list.scrollWidth - list.clientWidth
      const scrollable = extended && getComputedStyle(element).position === 'fixed' && maximum > 8
      const next = { scrollable, previous: scrollable && list.scrollLeft > 8, next: scrollable && list.scrollLeft < maximum - 8 }
      setEdges(previous => previous.scrollable === next.scrollable && previous.previous === next.previous && previous.next === next.next ? previous : next)
    }
    function measure() {
      shell?.style.setProperty('--bottom-navigation-space', getComputedStyle(element).position === 'fixed' ? `${element.getBoundingClientRect().height}px` : '0px')
      revealSelected(list)
      updateEdges()
    }
    const observer = new ResizeObserver(measure); observer.observe(element); observer.observe(list)
    list.addEventListener('scroll', updateEdges, { passive: true }); window.addEventListener('resize', measure); measure()
    return () => { observer.disconnect(); list.removeEventListener('scroll', updateEdges); window.removeEventListener('resize', measure); shell?.style.removeProperty('--bottom-navigation-space') }
  }, [extended])
  useLayoutEffect(() => { revealSelected(track.current) }, [selected])
  function scroll(direction) {
    const element = track.current
    element.scrollBy({ left: direction * Math.max(84, element.clientWidth * .8), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }
  return <nav ref={navigation} aria-label="Navegação principal" data-scrollable={edges.scrollable} className={`${styles.navigation} ${extended ? styles.extended : ''} ${publicNavigation ? styles.public : ''}`}>
    {extended && <button type="button" className={styles.scrollButton} aria-label="Mostrar separadores anteriores" disabled={!edges.previous} onClick={() => scroll(-1)}><AppArrow direction="left" /></button>}
    <div ref={track} className={styles.track} data-ui="navigation-items">
      {items.map(item => <button key={item.id} type="button" className={styles.item} aria-current={item.active ? 'page' : undefined} onClick={() => onNavigate(item.id)}><AppIcon name={item.icon} /><span>{item.label}</span></button>)}
    </div>
    {extended && <button type="button" className={styles.scrollButton} aria-label="Mostrar mais separadores" disabled={!edges.next} onClick={() => scroll(1)}><AppArrow direction="right" /></button>}
  </nav>
}
