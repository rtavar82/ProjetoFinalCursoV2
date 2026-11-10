import { useEffect, useRef, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
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
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [visible, setVisible] = useState(false)
  const [foreground, setForeground] = useState(() => document.visibilityState !== 'hidden')
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const region = useRef(null)

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
      if (items.length < 2 || reduced || !visible || !foreground || hovered || focused || !(carousel.canScrollNext() || carousel.canScrollPrev())) auto.stop()
      else auto.play()
    }
    synchronize()
    carousel.on('reInit', synchronize)
    return () => { carousel.off('reInit', synchronize); auto.stop() }
  }, [carousel, items.length, reduced, visible, foreground, hovered, focused])

  return <section className={styles.testimonialsEntry} aria-label="Testemunhos" ref={region}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    <a className={styles.testimonialsLink} href="#testemunhos" aria-labelledby="home-testimonials-title" onClick={event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      onNavigate('PublicTestimonials')
    }}>
      <h2 id="home-testimonials-title">Testemunhos</h2>
      <p>Conhece as experiências partilhadas por quem já passou pelas mãos da terapeuta Denise.</p>
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
  </section>
}
