import { useEffect, useRef, useState } from 'react'
import styles from './ConsultationPhotoPreview.module.css'

export default function ConsultationPhotoPreview({ file }) {
  const [url, setUrl] = useState('')
  const target = useRef(null)
  useEffect(() => {
    let value
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !value) { value = URL.createObjectURL(file); setUrl(value); observer.disconnect() }
    })
    observer.observe(target.current)
    return () => { observer.disconnect(); if (value) URL.revokeObjectURL(value) }
  }, [file])
  return <div ref={target} className={styles.preview}>{url && <img src={url} alt="Imagem selecionada para partilhar" />}</div>
}
