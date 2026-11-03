import ActionButton from './ActionButton'
import Heading from './Heading'

export default function DialogHeader({ title, titleId, titleRef, onClose, disabled = false, closeLabel = 'Fechar', className = '' }) {
  return <header className={`ui-dialog-header ${className}`}>
    {title && <Heading level={2} appearance="card-title" id={titleId} ref={titleRef} tabIndex={titleRef ? -1 : undefined}>{title}</Heading>}
    <ActionButton variant="secondary" className="ui-dialog-close" aria-label={closeLabel} disabled={disabled} onClick={onClose}>×</ActionButton>
  </header>
}
