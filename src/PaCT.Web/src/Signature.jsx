import styles from './Signature.module.css'

const defaultImage = '/presentation/denise-assinatura.png'

export default function Signature({ className = '', label = 'Assinatura de Denise Tavares', src = defaultImage, ...props }) {
  if (src !== defaultImage) return <img {...props} className={className} src={src} alt={label} loading="lazy" width="240" height="100" />
  return <span {...props} className={`${styles.signature} ${className}`} role="img" aria-label={label} />
}
