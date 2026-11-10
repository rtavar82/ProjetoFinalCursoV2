import { useEffect, useEffectEvent, useRef, useState } from 'react'

const step = 1.35
const clamp = (value, min, max) => Math.max(min, Math.min(value, max))

export default function useImageZoom(viewport, photo, imageId, onMove) {
  const controls = useRef(null)
  const [limits, setLimits] = useState({ canReduce: false, canEnlarge: true })
  const move = useEffectEvent(onMove)

  useEffect(() => {
    const view = viewport.current, image = photo.current
    let fitScale = 1, zoom = 1, x = 0, y = 0
    const pointers = new Map()
    const maxZoom = () => Math.max(4, 1 / fitScale)
    const bound = (size, room) => Math.max(0, (size * fitScale * zoom - room) / 2)

    function draw() {
      const limitX = bound(image.naturalWidth, view.clientWidth)
      const limitY = bound(image.naturalHeight, view.clientHeight)
      x = clamp(x, -limitX, limitX)
      y = clamp(y, -limitY, limitY)
      image.style.setProperty('--image-x', x + 'px')
      image.style.setProperty('--image-y', y + 'px')
      image.style.setProperty('--image-zoom', zoom)
      const canReduce = zoom > 1, canEnlarge = zoom < maxZoom()
      view.toggleAttribute('data-limit', !canEnlarge)
      setLimits(current => current.canReduce === canReduce && current.canEnlarge === canEnlarge
        ? current : { canReduce, canEnlarge })
    }

    function resize() {
      if (!image.naturalWidth || !view.clientWidth || !view.clientHeight) return
      fitScale = Math.min(1, view.clientWidth / image.naturalWidth, view.clientHeight / image.naturalHeight)
      image.style.width = image.naturalWidth * fitScale + 'px'
      image.style.height = image.naturalHeight * fitScale + 'px'
      zoom = clamp(zoom, 1, maxZoom())
      draw()
    }

    function zoomAt(value, point = { x: 0, y: 0 }, shift = { x: 0, y: 0 }) {
      const next = clamp(value, 1, maxZoom())
      const ratio = next / zoom
      x = point.x + (x - point.x) * ratio + shift.x
      y = point.y + (y - point.y) * ratio + shift.y
      zoom = next
      draw()
    }

    const zoomBy = direction => zoomAt(zoom * step ** direction)
    controls.current = {
      zoomBy,
      original: () => zoomAt(1 / fitScale),
      fit: () => { zoom = 1; x = 0; y = 0; draw() },
    }

    function point(event) {
      const rect = view.getBoundingClientRect()
      return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }
    }

    function pinch() {
      const [first, second] = pointers.values()
      return {
        center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
        distance: Math.hypot(first.x - second.x, first.y - second.y),
      }
    }

    function start(event) {
      if (event.button !== 0 || pointers.size >= 2) return
      const at = point(event)
      const multi = pointers.size > 0
      if (multi) for (const pointer of pointers.values()) pointer.multi = true
      pointers.set(event.pointerId, { ...at, start: at, onImage: event.target === image, moved: multi, multi })
      view.setPointerCapture(event.pointerId)
    }

    function drag(event) {
      const pointer = pointers.get(event.pointerId)
      if (!pointer) return
      const at = point(event)
      if (pointers.size === 2) {
        const before = pinch()
        Object.assign(pointer, at, { moved: true })
        const after = pinch()
        zoomAt(zoom * after.distance / Math.max(1, before.distance), before.center,
          { x: after.center.x - before.center.x, y: after.center.y - before.center.y })
        return
      }
      if (!pointer.moved && Math.hypot(at.x - pointer.start.x, at.y - pointer.start.y) < 4) return
      pointer.moved = true
      if (zoom > 1) {
        x += at.x - pointer.x
        y += at.y - pointer.y
        view.setAttribute('data-dragging', '')
        draw()
      }
      Object.assign(pointer, at)
    }

    function stop(event) {
      const pointer = pointers.get(event.pointerId)
      if (!pointer) return
      pointers.delete(event.pointerId)
      view.removeAttribute('data-dragging')
      if (event.type !== 'pointerup') return
      const at = point(event)
      if (event.pointerType === 'mouse' && pointer.onImage && !pointer.moved) zoomAt(zoom * step, at)
      if (event.pointerType === 'touch' && zoom === 1 && !pointer.multi) {
        const horizontal = at.x - pointer.start.x
        const vertical = at.y - pointer.start.y
        if (Math.abs(horizontal) > 45 && Math.abs(horizontal) > Math.abs(vertical)) move(horizontal < 0 ? 1 : -1)
      }
    }

    function wheel(event) {
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.clientHeight : 1
      zoomAt(zoom * Math.exp(-clamp(event.deltaY * unit, -160, 160) * .003), point(event))
    }

    function contextMenu(event) {
      if (event.button !== 2 || event.target !== image) return
      event.preventDefault()
      zoomAt(zoom / step, point(event))
    }

    function key(event) {
      if (['+', '=', '-'].includes(event.key)) {
        event.preventDefault()
        zoomBy(event.key === '-' ? -1 : 1)
        return
      }
      const directions = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }
      const direction = directions[event.key]
      if (!direction) return
      if (zoom > 1) {
        event.preventDefault()
        x += direction[0]
        y += direction[1]
        draw()
      } else if (direction[0]) {
        event.preventDefault()
        move(direction[0] > 0 ? -1 : 1)
      }
    }

    const abort = new AbortController()
    const options = { signal: abort.signal }
    for (const [event, handler] of Object.entries({
      pointerdown: start, pointermove: drag, pointerup: stop, pointercancel: stop,
      lostpointercapture: stop, keydown: key, contextmenu: contextMenu,
    })) view.addEventListener(event, handler, options)
    view.addEventListener('wheel', wheel, { ...options, passive: false })
    image.addEventListener('load', resize, options)
    const observer = new ResizeObserver(resize)
    observer.observe(view)
    const frame = requestAnimationFrame(resize)
    return () => {
      abort.abort()
      observer.disconnect()
      cancelAnimationFrame(frame)
      view.removeAttribute('data-dragging')
      view.removeAttribute('data-limit')
    }
  }, [viewport, photo, imageId])

  return { controls, ...limits }
}
