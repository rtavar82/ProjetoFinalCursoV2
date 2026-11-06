import { useEffect, useRef, useState } from 'react'
import styles from './ConsultationPhotoPreview.module.css'

export default function ConsultationPhotoPreview({ file, src, alt = 'Imagem selecionada para partilhar' }) {
  const [preview, setPreview] = useState(null)
  const target = useRef(null)
  useEffect(() => {
    if (!file) return
    let value
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !value) { value = URL.createObjectURL(file); setPreview({ file, url: value }); observer.disconnect() }
    })
    observer.observe(target.current)
    return () => { observer.disconnect(); if (value) URL.revokeObjectURL(value) }
  }, [file])
  const source = file ? (preview?.file === file ? preview.url : '') : src
  return <div ref={target} className={styles.preview}>{source && <img src={source} alt={alt} loading="lazy" />}</div>
}
