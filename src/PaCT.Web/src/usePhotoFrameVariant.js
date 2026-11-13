import { useSyncExternalStore } from 'react'
import { PHOTO_FRAME_PERIOD, photoFramePeriod, photoFrameVariant } from './photoFrameSchedule'

const listeners = new Set()
let timer

function reschedule() {
  clearTimeout(timer)
  if (listeners.size) timer = setTimeout(update, PHOTO_FRAME_PERIOD - Date.now() % PHOTO_FRAME_PERIOD + 20)
}
function update() {
  for (const listener of listeners) listener()
  reschedule()
}
function resume() {
  if (document.visibilityState !== 'hidden') update()
}
function subscribe(listener) {
  listeners.add(listener)
  if (listeners.size === 1) {
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    reschedule()
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      clearTimeout(timer)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }
}

export default function usePhotoFrameVariant(frameKey) {
  const period = useSyncExternalStore(subscribe, photoFramePeriod, () => 0)
  return photoFrameVariant(frameKey, period)
}
