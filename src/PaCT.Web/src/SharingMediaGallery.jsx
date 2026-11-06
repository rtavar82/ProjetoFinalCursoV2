import { useRef, useState } from 'react'
import ActionButton from './ActionButton'
import AppIcon from './AppIcon'
import AudioPlayer from './AudioPlayer'
import ConsultationDialog from './ConsultationDialog'
import styles from './SharingFeed.module.css'

const zoomLevels = [styles.imageFit, styles.imageZoomOne, styles.imageZoomTwo, styles.imageZoomThree]

export default function SharingMediaGallery({ media }) {
  const [selected, setSelected] = useState(null)
  const opener = useRef(null)
  const images = media.filter(item => item.type.startsWith('image/'))
  const photo = images[0]
  const video = media.find(item => item.type === 'video/mp4')
  const audio = media.find(item => item.type.startsWith('audio/'))
  const imageIndex = images.findIndex(item => item.id === selected)
  const remaining = images.length - 1

  function open(event, item) {
    opener.current = event.currentTarget
    setSelected(item.id)
  }

  function close() {
    setSelected(null)
    requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }))
  }

  return <>
    {(photo || video) && <div className={photo && video ? styles.mediaPair : styles.mediaTiles}>
      {photo && <ActionButton variant="secondary" className={styles.mediaTile + ' ' + styles.photoTile}
        aria-label={images.length === 1 ? 'Ampliar imagem' : `Abrir galeria de ${images.length} fotografias`}
        onClick={event => open(event, photo)}>
        <img src={photo.url} alt="" loading="lazy" />
        <span className={styles.photoLabel}>{remaining > 0 ? `+${remaining} ${remaining === 1 ? 'foto' : 'fotos'}` : 'Foto'}</span>
      </ActionButton>}
      {video && <ActionButton variant="secondary" className={styles.mediaTile}
        aria-label="Reproduzir vídeo" onClick={event => open(event, video)}>
        {video.posterUrl && <img src={video.posterUrl} alt="" loading="lazy" />}
        <span className={styles.playVideo}>
          <span className={styles.playIcon}><AppIcon name="play" /></span>
          <span className={styles.videoLabel}>Vídeo</span>
        </span>
      </ActionButton>}
    </div>}
    {audio && <AudioPlayer src={audio.url} label="Áudio da publicação" />}
    {imageIndex >= 0 && <ImageViewer images={images} index={imageIndex}
      onSelect={index => setSelected(images[index].id)} onClose={close} />}
    {video && selected === video.id && <ConsultationDialog title="Vídeo da publicação" label="Vídeo da publicação" onClose={close}>
      <video className={styles.videoPlayer} src={video.url} poster={video.posterUrl} controls autoPlay playsInline
        aria-label="Vídeo da publicação" />
    </ConsultationDialog>}
  </>
}

function ImageViewer({ images, index, onSelect, onClose }) {
  const [zoom, setZoom] = useState(0)
  const touch = useRef(null)
  const viewport = useRef(null)
  const image = images[index]
  const first = index === 0
  const last = index === images.length - 1

  function move(step) {
    if (step < 0 ? first : last) return
    setZoom(0)
    viewport.current.scrollTo(0, 0)
    onSelect(index + step)
  }

  return <ConsultationDialog title="Imagens da publicação" label="Imagens da publicação" onClose={onClose}>
    <div ref={viewport} className={styles.imageViewport} tabIndex={0} aria-label="Visualização da imagem"
      onKeyDown={event => {
        if (zoom !== 0 || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
        event.preventDefault()
        move(event.key === 'ArrowLeft' ? -1 : 1)
      }}
      onTouchStart={event => {
        const point = event.touches[0]
        touch.current = zoom === 0 && event.touches.length === 1 ? { x: point.clientX, y: point.clientY } : null
      }}
      onTouchCancel={() => { touch.current = null }}
      onTouchEnd={event => {
        const start = touch.current
        touch.current = null
        if (!start || event.touches.length > 0) return
        const point = event.changedTouches[0]
        const horizontal = point.clientX - start.x
        const vertical = point.clientY - start.y
        if (Math.abs(horizontal) > 45 && Math.abs(horizontal) > Math.abs(vertical)) move(horizontal < 0 ? 1 : -1)
      }}>
      <img className={zoomLevels[zoom]} src={image.url} alt={'Imagem ' + (index + 1) + ' da publicação'} />
    </div>
    <div className={styles.actions}>
      {images.length > 1 && <>
        <ActionButton variant="secondary" disabled={first} onClick={() => move(-1)}>Anterior</ActionButton>
        <span role="status">{index + 1} de {images.length}</span>
        <ActionButton variant="secondary" disabled={last} onClick={() => move(1)}>Seguinte</ActionButton>
      </>}
      <ActionButton variant="secondary" className={styles.imageZoomControl} disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}>Reduzir</ActionButton>
      <ActionButton variant="secondary" className={styles.imageZoomControl} disabled={zoom === zoomLevels.length - 1} onClick={() => setZoom(zoom + 1)}>Ampliar</ActionButton>
      <a href={image.url} download={'partilha-' + image.id + (image.type === 'image/png' ? '.png' : '.jpg')}>Descarregar imagem</a>
    </div>
  </ConsultationDialog>
}
