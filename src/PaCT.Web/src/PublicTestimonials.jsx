import AppArrow from './AppArrow'
import { useEffect, useRef, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { createTestimonialMotion } from './testimonialMotion'
import useLiveResource from './useLiveResource'
import { readPublicTestimonials } from './testimonialData'
import ConsultationDialog from './ConsultationDialog'
import ActionButton from './ActionButton'
import Heading from './Heading'
import styles from './Testimonials.module.css'

export function TestimonialViewer({ item, onClose, imageUrl = item.imageUrl }) {
  const [returnFocus] = useState(() => document.activeElement)
  useEffect(() => () => { if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }) }, [returnFocus])
  return <ConsultationDialog title="Testemunho" className={styles.viewer} label="Testemunho" onClose={onClose}>
    {imageUrl && <img src={imageUrl} alt="Imagem da publicação" />}
    {item.text && <p className={styles.fullText}>{item.text}</p>}
  </ConsultationDialog>
}

export default function PublicTestimonials({ onBack }) {
  const resource = useLiveResource('publicTestimonials', 'public-testimonials', readPublicTestimonials)
  return <section className={styles.page} aria-labelledby="testimonials-title">
    <ActionButton variant="text" onClick={onBack}><AppArrow direction="left" /> Voltar ao início</ActionButton>
    <Heading level={1} id="testimonials-title">Testemunhos</Heading>
    {resource.data?.length > 0 && <p className={styles.hint}>Seleciona um cartão para ver a imagem e o texto completos.</p>}
    {resource.error && <div className="notice error" role="alert"><p>{resource.error}</p><ActionButton variant="secondary" onClick={resource.refresh}>Voltar a tentar</ActionButton></div>}
    {resource.loading && <p role="status">A consultar os testemunhos…</p>}
    {resource.data?.length === 0 && <p>Ainda não existem testemunhos publicados.</p>}
    {resource.data?.length > 0 && <TestimonialCarousel items={resource.data} />}
  </section>
}

function TestimonialCarousel({ items }) {
  const [plugins] = useState(() => [createTestimonialMotion()])
  const [viewport, embla] = useEmblaCarousel({ loop: true, align: 'start', dragFree: true }, plugins)
  const [canMove, setCanMove] = useState(false)
  const [selectedId, select] = useState(null)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [visible, setVisible] = useState(false)
  const [foreground, setForeground] = useState(() => document.visibilityState !== 'hidden')
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [dragging, setDragging] = useState(false)
  const region = useRef(null)
  const selected = items.find(item => item.id === selectedId)
  const paused = reduced || !visible || !foreground || hovered || focused || dragging || !!selected

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const preference = () => setReduced(media.matches)
    const visibility = () => setForeground(document.visibilityState !== 'hidden')
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(region.current)
    media.addEventListener('change', preference)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', preference)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])

  useEffect(() => {
    if (!embla) return
    const update = () => setCanMove(embla.canScrollNext() || embla.canScrollPrev())
    const startDrag = () => setDragging(true)
    const finishDrag = () => setDragging(false)
    update()
    embla.on('reInit', update).on('pointerDown', startDrag).on('pointerUp', finishDrag)
    return () => { embla.off('reInit', update).off('pointerDown', startDrag).off('pointerUp', finishDrag) }
  }, [embla])

  useEffect(() => {
    if (!embla) return
    const auto = embla.plugins().autoScroll
    let restart
    function synchronize() {
      if (paused || !(embla.canScrollNext() || embla.canScrollPrev())) { auto.stop(); return }
      if (!embla.canScrollNext()) embla.scrollTo(0, true)
      auto.play()
    }
    // When there are too few cards for a seamless loop, return to the first card at the end.
    function stopped() {
      if (!paused && !embla.canScrollNext() && embla.canScrollPrev()) restart = requestAnimationFrame(synchronize)
    }
    embla.on('reInit', synchronize).on('autoScroll:stop', stopped)
    synchronize()
    return () => {
      cancelAnimationFrame(restart)
      embla.off('reInit', synchronize).off('autoScroll:stop', stopped)
      auto.stop()
    }
  }, [embla, paused])

  function move(direction) {
    if (direction > 0) embla?.scrollNext()
    else embla?.scrollPrev()
  }

  return <div className={styles.carousel} ref={region} role="region" aria-label="Testemunhos publicados" aria-roledescription="carrossel"
    onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(true) }}
    onPointerLeave={event => { if (event.pointerType === 'mouse') setHovered(false) }}
    onFocusCapture={event => setFocused(event.target.matches(':focus-visible'))}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    {canMove && <div className={styles.controls}>
      <ActionButton variant="secondary" onClick={() => move(-1)} aria-label="Testemunho anterior"><AppArrow direction="left" /></ActionButton>
      <ActionButton variant="secondary" onClick={() => move(1)} aria-label="Testemunho seguinte"><AppArrow direction="right" /></ActionButton>
    </div>}
    <div className={styles.viewport} ref={viewport}>
      <div className={styles.track}>{items.map((item, index) => <div key={item.id} className={styles.slide} role="group" aria-roledescription="publicação" aria-label={`${index + 1} de ${items.length}`}>
        <ActionButton className={styles.card} onClick={() => select(item.id)} aria-label={`Abrir testemunho ${index + 1}`}>
          {item.imageUrl && <img src={item.imageUrl} alt="Imagem da publicação" loading="lazy" />}
          {item.text && <span className={styles.cardContent}><span className={styles.cardText}>{item.text}</span></span>}
        </ActionButton>
      </div>)}</div>
    </div>
    {selected && <TestimonialViewer item={selected} onClose={() => select(null)} />}
  </div>
}
