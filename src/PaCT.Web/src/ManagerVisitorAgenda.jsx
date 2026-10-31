import { useState } from 'react'
import VisitorAgenda from './VisitorAgenda'
import styles from './ManagerAgenda.module.css'

export default function ManagerVisitorAgenda({ onBack }) {
  const [selection, setSelection] = useState(null)
  return <section className={styles.page} aria-label="Agenda como visitante">
    <header className={styles.visitorHeader}><p>Vista de visitante</p><button type="button" className="secondary" onClick={onBack}>Voltar à agenda de gestão</button></header>
    <VisitorAgenda previewOnly selection={selection} onChoose={setSelection} onBack={() => setSelection(null)} />
  </section>
}
