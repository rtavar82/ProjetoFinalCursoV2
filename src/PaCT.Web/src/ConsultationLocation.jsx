import styles from './ConsultationLocation.module.css'

export default function ConsultationLocation({ modality, publicLocation, instructions, manager = false }) {
  return <div className={styles.location} aria-label="Local da consulta">
    <p>{modality === 'Remote' ? 'Consulta remota' : [publicLocation, 'Presencial'].filter(Boolean).join(' · ')}</p>
    {instructions && (!manager || modality === 'InPerson') && <p className={styles.instructions}>{instructions}</p>}
  </div>
}
