export const PHOTO_FRAME_PERIOD = 12 * 60 * 60 * 1000
const variants = ['garden', 'transformation', 'bloom']

function hash(value) {
  let result = 2166136261
  for (const character of String(value)) result = Math.imul(result ^ character.codePointAt(0), 16777619)
  result = Math.imul(result ^ result >>> 16, 0x85ebca6b)
  result = Math.imul(result ^ result >>> 13, 0xc2b2ae35)
  return (result ^ result >>> 16) >>> 0
}

export function photoFramePeriod(now = Date.now()) {
  return Math.floor(now / PHOTO_FRAME_PERIOD)
}

export function photoFrameVariant(frameKey, period = photoFramePeriod()) {
  const cycle = Math.floor(period / 3)
  const position = ((period % 3) + 3) % 3
  const offset = hash(frameKey) % 3
  // Each 36-hour cycle visits all three frames in a seeded, stable random order.
  // The first position is fixed per photo, so adjacent cycles cannot repeat a frame.
  const direction = hash(frameKey + ':' + cycle) % 2 + 1
  return variants[(offset + position * direction) % 3]
}
