import { useId, useLayoutEffect, useRef } from 'react'
import ActionButton from './ActionButton'
import AdaptiveSelect from './AdaptiveSelect'
import Heading from './Heading'
import InformationCard from './InformationCard'
import styles from './MenuDetailLayout.module.css'

export default function MenuDetailLayout({ items, value, onChange, disabled = false, label, selectorLabel, cardId, status, children }) {
  const id = useId(), heading = useRef(null), previous = useRef(value)
  const item = items.find(item => item.id === value)
  useLayoutEffect(() => {
    if (previous.current !== value) heading.current?.focus({ preventScroll: true })
    previous.current = value
  }, [value])
  return <section className={styles.layout} aria-label={label} data-ui="menu-detail">
    <div className={styles.workspace}>
      <nav className={styles.menu} aria-label={label}>
        {items.map(item => <ActionButton key={item.id} variant={item.id === value ? 'tinted' : 'secondary'}
          className={styles.item} aria-label={item.label} aria-describedby={item.description ? id + '-' + item.id + '-description' : undefined} aria-current={item.id === value ? 'true' : undefined}
          aria-controls={id + '-detail'} disabled={disabled} onClick={() => onChange(item.id)}>
          <span>{item.label}</span>
          {item.description && <small id={id + '-' + item.id + '-description'}>{item.description}</small>}
        </ActionButton>)}
      </nav>
      <label className={styles.selector}>{selectorLabel}
        <AdaptiveSelect variant="tinted" value={value} disabled={disabled} aria-label={selectorLabel} aria-controls={id + '-detail'} onChange={event => onChange(event.target.value)}>
          {items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </AdaptiveSelect>
      </label>
      <InformationCard className={styles.detail} cardId={cardId} id={id + '-detail'} aria-labelledby={id + '-title'}>
        <header className={styles.header}>
          <Heading level={2} appearance="card-title" ref={heading} id={id + '-title'} tabIndex={-1}>{item?.label}</Heading>
          {status && <p className={styles.status}>{status}</p>}
        </header>
        <div className={styles.content}>{children}</div>
      </InformationCard>
    </div>
  </section>
}
