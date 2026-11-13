import { useContext } from 'react'
import BrandButterfly from './BrandButterfly'
import { PageIdentityContext } from './pageIdentityContext'
import styles from './Heading.module.css'

export default function Heading({ level = 2, appearance, brand = true, className = '', children, ...props }) {
  const enabled = useContext(PageIdentityContext)
  const decorated = level === 1 && brand && enabled
  const Element = `h${level}`
  return <Element {...props} data-typography={appearance} data-ui={decorated ? 'branded-heading' : undefined} className={`${decorated ? styles.branded : ''} ${className}`}>
    {decorated ? <><span data-ui="heading-text">{children}</span><BrandButterfly className={styles.mark} /></> : children}
  </Element>
}
