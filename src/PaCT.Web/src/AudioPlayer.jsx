import styles from './AudioPlayer.module.css'

export default function AudioPlayer({ src, label }) {
  return <audio className={styles.player} src={src} controls preload="none" aria-label={label} />
}
