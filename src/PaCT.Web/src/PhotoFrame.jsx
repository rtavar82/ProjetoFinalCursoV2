import usePhotoFrameVariant from './usePhotoFrameVariant'
import styles from './PhotoFrame.module.css'

export default function PhotoFrame({ frameKey, src, alt, className = '', ...imageProps }) {
  const variant = usePhotoFrameVariant(frameKey)
  if (!src) return null
  return <span className={`${styles.frame} ${styles[variant]} ${className}`} data-ui="photo-frame" data-frame-variant={variant}>
    <img {...imageProps} className={styles.image} src={src} alt={alt} />
    <span className={styles.butterflies} aria-hidden="true" />
  </span>
}
