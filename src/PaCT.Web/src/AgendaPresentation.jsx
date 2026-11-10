import Heading from './Heading'
import styles from './AgendaPresentation.module.css'

export default function AgendaPresentation({ introNote, children, ...props }) {
  return <section {...props} className={styles.page}>
    <div className={styles.intro}>
      <p className="eyebrow">A TUA AGENDA</p>
      <Heading level={1}>Um tempo para ti.</Heading>
      <p>Escolhe o dia. Encontra o teu horário.</p>
      {introNote && <p>{introNote}</p>}
    </div>
    <div className={styles.content}>{children}</div>
  </section>
}
