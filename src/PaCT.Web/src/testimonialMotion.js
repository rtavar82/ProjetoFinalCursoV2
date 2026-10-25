import AutoScroll from 'embla-carousel-auto-scroll'

// Both public views use the same continuous movement, speed and interaction policy.
export function createTestimonialMotion() {
  return AutoScroll({ speed: 0.5, startDelay: 300, playOnInit: false, stopOnInteraction: true, stopOnMouseEnter: true, stopOnFocusIn: true })
}
