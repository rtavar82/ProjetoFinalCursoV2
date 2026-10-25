import { useEffect, useRef, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import AppIcon from './AppIcon'
import useLiveResource from './useLiveResource'
import { readPublicTestimonials } from './testimonialData'
import { createTestimonialMotion } from './testimonialMotion'
import styles from './PublicPresentation.module.css'

export default function HomeTestimonialCard({ onNavigate }) {
  const resource = useLiveResource('publicTestimonials', 'public-testimonials', readPublicTestimonials)
  const items = resource.data || []
  const [plugins] = useState(() => [createTestimonialMotion()])
  const [viewport, carousel] = useEmblaCarousel({ loop: true, align: 'start', watchDrag: false, dragFree: true }, plugins)
  const [selected, setSelected] = useState(0)
  const [motion, setMotion] = useState(null)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [visible, setVisible] = useState(false)
  const [foreground, setForeground] = useState(() => document.visibilityState !== 'hidden')
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const region = useRef(null)
  const autoplay = motion ?? !reduced

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const preference = () => setReduced(media.matches)
    const visibility = () => setForeground(document.visibilityState !== 'hidden')
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting))
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
    if (!carousel) return
    const update = () => setSelected(carousel.selectedScrollSnap())
    carousel.on('select', update).on('reInit', update)
    return () => { carousel.off('select', update).off('reInit', update) }
  }, [carousel])

  useEffect(() => {
    if (!carousel) return
    const auto = carousel.plugins().autoScroll
    function synchronize() {
      if (items.length < 2 || !autoplay || !visible || !foreground || hovered || focused || !(carousel.canScrollNext() || carousel.canScrollPrev())) auto.stop()
      else auto.play()
    }
    synchronize()
    carousel.on('reInit', synchronize)
    return () => { carousel.off('reInit', synchronize); auto.stop() }
  }, [carousel, items.length, autoplay, visible, foreground, hovered, focused])

  return <section className={styles.testimonialsEntry} aria-label="Testemunhos" ref={region}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    <a className={styles.testimonialsLink} href="#testemunhos" aria-label="Ver testemunhos" onClick={event => { event.preventDefault(); onNavigate('PublicTestimonials') }}>
      <div className={styles.testimonialsHeading}><div><p className="eyebrow">Testemunhos</p><h2>Ver testemunhos</h2></div><AppIcon name="arrow" /></div>
      {resource.loading && <p role="status">A consultar os testemunhos…</p>}
      {resource.error && <p role="alert">Não foi possível carregar a pré-visualização. Abre a página de testemunhos para tentar novamente.</p>}
      {resource.data?.length === 0 && <p className={styles.testimonialsEmpty}>Ainda não existem testemunhos publicados.</p>}
      <div className={styles.testimonialsViewport} ref={viewport} hidden={!items.length}>
        <div className={styles.testimonialsTrack}>{items.map((item, index) => <div className={styles.testimonialsPreview} key={item.id} aria-hidden={index !== selected}>
          {item.imageUrl && <img src={item.imageUrl} alt="Imagem da publicação" loading="lazy" />}
          {item.text && <p>{item.text}</p>}
        </div>)}</div>
      </div>
    </a>
    {items.length > 1 && <div className={styles.testimonialsTools}>
      <span>{Math.min(selected + 1, items.length)} / {items.length}</span>
      <button type="button" className="text-button" aria-label={autoplay ? 'Parar pré-visualização' : 'Retomar pré-visualização'} onClick={() => setMotion(!autoplay)}>{autoplay ? 'Parar' : 'Retomar'}</button>
    </div>}
  </section>
}
