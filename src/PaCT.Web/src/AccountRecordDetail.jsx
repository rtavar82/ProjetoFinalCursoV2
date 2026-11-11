import { useLayoutEffect, useRef } from 'react'
import ActionButton from './ActionButton'
import Heading from './Heading'
import InformationCard from './InformationCard'

export default function AccountRecordDetail({ title, back, onBack, disabled, children, ...props }) {
  const heading = useRef(null)
  useLayoutEffect(() => { heading.current?.focus() }, [])

  return <InformationCard {...props} aria-label={title}>
    <ActionButton variant="text" onClick={onBack} disabled={disabled}>{back}</ActionButton>
    <Heading level={3} appearance="card-title" ref={heading} tabIndex={-1}>{title}</Heading>
    {children}
  </InformationCard>
}
