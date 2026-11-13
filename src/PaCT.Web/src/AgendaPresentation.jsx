import Heading from './Heading'
import styles from './AgendaPresentation.module.css'

export default function AgendaPresentation({ introNote, title = 'Um tempo para ti.', description = 'Escolhe o dia. Encontra o teu horário.', eyebrow = 'A TUA AGENDA', headingId, contentClassName = '', children, ...props }) {
  return <section {...props} className={styles.page}>
    <div className={styles.intro}>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <Heading level={1} id={headingId}>{title}</Heading>
      {description && <p>{description}</p>}
      {introNote && <p>{introNote}</p>}
    </div>
    <div className={`${styles.content} ${contentClassName}`}>{children}</div>
  </section>
}
