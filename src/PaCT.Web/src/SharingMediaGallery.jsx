import { useRef, useState } from 'react'
import ActionButton from './ActionButton'
import AppIcon from './AppIcon'
import AudioPlayer from './AudioPlayer'
import ConsultationDialog from './ConsultationDialog'
import styles from './SharingFeed.module.css'
import useImageZoom from './useImageZoom'


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
  const viewport = useRef(null), photo = useRef(null)
  const image = images[index]
  const first = index === 0, last = index === images.length - 1
  function move(step) {
    if (step < 0 ? first : last) return
    onSelect(index + step)
  }
  const { controls, canEnlarge, canReduce } = useImageZoom(viewport, photo, image.id, move)
  return <ConsultationDialog title="Imagens da publicação" label="Imagens da publicação" onClose={onClose} className={styles.imageDialog}>
    <div ref={viewport} className={styles.imageViewport} tabIndex={0} role="region" aria-label="Visualização da imagem" aria-describedby="pact-image-hint">
      <img key={image.id} ref={photo} src={image.url} alt={'Imagem ' + (index + 1) + ' da publicação'} draggable={false} />
    </div>
    {images.length > 1 && <div className={styles.zoomControls} aria-label="Galeria">
      <ActionButton variant="secondary" disabled={first} onClick={() => move(-1)}>Anterior</ActionButton>
      <span role="status">{index + 1} de {images.length}</span>
      <ActionButton variant="secondary" disabled={last} onClick={() => move(1)}>Seguinte</ActionButton>
    </div>}
    <div className={styles.zoomControls} role="group" aria-label="Zoom da imagem">
      <ActionButton variant="secondary" disabled={!canReduce} aria-label="Reduzir" onClick={() => controls.current?.zoomBy(-1)}>−</ActionButton>
      <ActionButton variant="secondary" disabled={!canEnlarge} aria-label="Ampliar" onClick={() => controls.current?.zoomBy(1)}>+</ActionButton>
      <ActionButton variant="secondary" onClick={() => controls.current?.fit()}>Ajustar</ActionButton>
      <ActionButton variant="secondary" aria-label="Ver ao tamanho original (100%)" onClick={() => controls.current?.original()}>100%</ActionButton>
      <a href={image.url} download={'partilha-' + image.id + (image.type === 'image/png' ? '.png' : '.jpg')}>Descarregar imagem</a>
    </div>
    <p id="pact-image-hint" className={styles.imageHint}>
      <span className={styles.mouseHint}>Usa os cliques ou a roda do rato para ampliar ou reduzir.</span>
      <span className={styles.touchHint}>Afasta ou aproxima dois dedos para ampliar ou reduzir.</span> Arrasta para percorrer.
    </p>
  </ConsultationDialog>
}
