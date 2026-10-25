import { useLayoutEffect, useRef } from 'react'
import PwaStatus from './PwaStatus'
import styles from './AppFrame.module.css'

export default function AppFrame({ children }) {
  const frame = useRef(null)
  const notices = useRef(null)

  useLayoutEffect(() => {
    const container = frame.current
    const element = notices.current
    // Measure the actual notice, including wrapping, without remounting readers or editors.
    function measure() {
      container.style.setProperty('--app-banner-height', `${element.getBoundingClientRect().height}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return <div ref={frame} className={styles.frame}>
    <div ref={notices} className={styles.notices}><PwaStatus /></div>
    {children}
  </div>
}
