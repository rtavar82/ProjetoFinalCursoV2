import { useEffect, useRef, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { createTestimonialMotion } from './testimonialMotion'
import useLiveResource from './useLiveResource'
import { readPublicTestimonials } from './testimonialData'
import ConsultationDialog from './ConsultationDialog'
import styles from './Testimonials.module.css'

export function TestimonialViewer({ item, onClose, imageUrl = item.imageUrl }) {
  const [returnFocus] = useState(() => document.activeElement)
  useEffect(() => () => { if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }) }, [returnFocus])
  return <ConsultationDialog compact className={styles.viewer} label="Testemunho" onClose={onClose}>
    <h2>Testemunho</h2>
    {imageUrl && <img src={imageUrl} alt="Imagem da publicação" />}
    {item.text && <p className={styles.fullText}>{item.text}</p>}
  </ConsultationDialog>
}

export default function PublicTestimonials({ onBack }) {
  const resource = useLiveResource('publicTestimonials', 'public-testimonials', readPublicTestimonials)
  return <section className={styles.page} aria-labelledby="testimonials-title">
    <button type="button" className="text-button" onClick={onBack}>← Voltar ao início</button>
    <h1 id="testimonials-title">Testemunhos</h1>
    {resource.error && <div className="notice error" role="alert"><p>{resource.error}</p><button type="button" className="secondary" onClick={resource.refresh}>Voltar a tentar</button></div>}
    {resource.loading && <p role="status">A consultar os testemunhos…</p>}
    {resource.data?.length === 0 && <p>Ainda não existem testemunhos publicados.</p>}
    {resource.data?.length > 0 && <TestimonialCarousel items={resource.data} />}
  </section>
}

function TestimonialCarousel({ items }) {
  const [plugins] = useState(() => [createTestimonialMotion()])
  const [viewport, embla] = useEmblaCarousel({ loop: true, align: 'start', dragFree: true }, plugins)
  const [playing, setPlaying] = useState(false)
  const [canMove, setCanMove] = useState(false)
  const [selectedId, select] = useState(null)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const manualPause = useRef(false)
  const rotationIntent = useRef(null)
  const region = useRef(null)
  const selected = items.find(item => item.id === selectedId)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    if (!embla) return
    const auto = embla.plugins().autoScroll
    function update() { setPlaying(auto.isPlaying()); setCanMove(embla.canScrollNext() || embla.canScrollPrev()) }
    function started() { setPlaying(true); setCanMove(embla.canScrollNext() || embla.canScrollPrev()) }
    function stopped() { setPlaying(false) }
    function visible() {
      if (document.visibilityState === 'hidden' || reduced || manualPause.current) auto.stop()
      else if (embla.canScrollNext() || embla.canScrollPrev()) auto.play()
    }
    function reInit() { update(); visible() }
    embla.on('autoScroll:play', started).on('autoScroll:stop', stopped).on('reInit', reInit)
    document.addEventListener('visibilitychange', visible)
    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) auto.stop()
      else visible()
    })
    observer.observe(region.current)
    update()
    return () => {
      observer.disconnect(); document.removeEventListener('visibilitychange', visible)
      embla.off('autoScroll:play', started).off('autoScroll:stop', stopped).off('reInit', reInit); auto.stop()
    }
  }, [embla, reduced])
  function pause() { manualPause.current = true; embla?.plugins().autoScroll.stop() }
  function toggle() {
    const auto = embla?.plugins().autoScroll
    if (rotationIntent.current ?? auto?.isPlaying()) pause()
    else { manualPause.current = false; auto?.play() }
    rotationIntent.current = null
  }
  function move(direction) { pause(); if (direction > 0) embla?.scrollNext(); else embla?.scrollPrev() }
  return <div className={styles.carousel} ref={region} role="region" aria-label="Testemunhos publicados" aria-roledescription="carrossel" onFocusCapture={pause}>
    <div className={styles.controls}>
      <button type="button" className="secondary" disabled={!canMove} onPointerDown={() => { rotationIntent.current = embla?.plugins().autoScroll.isPlaying() }} onKeyDown={() => { rotationIntent.current = null }} onClick={toggle}>{playing ? 'Parar movimento' : 'Retomar movimento'}</button>
      <button type="button" className="secondary" disabled={!canMove} onClick={() => move(-1)} aria-label="Testemunho anterior">←</button>
      <button type="button" className="secondary" disabled={!canMove} onClick={() => move(1)} aria-label="Testemunho seguinte">→</button>
    </div>
    <div className={styles.viewport} ref={viewport}>
      <div className={styles.track}>{items.map((item, index) => <div key={item.id} className={styles.slide} role="group" aria-roledescription="publicação" aria-label={`${index + 1} de ${items.length}`}>
        <button type="button" className={styles.card} onClick={() => { pause(); select(item.id) }} aria-label={`Abrir testemunho ${index + 1}`}>
          {item.imageUrl && <img src={item.imageUrl} alt="Imagem da publicação" loading="lazy" />}
          {item.text && <p>{item.text}</p>}
          <span className={styles.readMore}>{item.imageUrl && !item.text ? 'Ampliar imagem' : 'Ler testemunho'}</span>
        </button>
      </div>)}</div>
    </div>
    <p className={styles.hint}>Seleciona um cartão para ver a imagem e o texto completos.</p>
    {selected && <TestimonialViewer item={selected} onClose={() => select(null)} />}
  </div>
}
