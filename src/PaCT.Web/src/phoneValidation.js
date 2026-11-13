// National digits only; spaces, separators and explicit Portuguese calling codes remain accepted.
export const portuguesePhonePattern = String.raw`\s*(?:(?:\+351|00351)(?:\s|\(|\)|-)*)?(?:[0-9](?:\s|\(|\)|-)*){9}`

export function contactPhonePattern(key, value) {
  if (key === 'therapist.telephone' && value.startsWith('tel:+351')) return String.raw`tel:\+351[0-9]{9}`
  if (key === 'therapist.whatsapp' && value.startsWith('https://wa.me/351')) return String.raw`https://wa\.me/351[0-9]{9}`
  if (key === 'payment.mbWay') return String.raw`(?:[0-9]\s*){9}`
}

export function nationalPortuguesePhone(value) {
  const text = value.trim()
  if (!/^(?:\+351|00351)/.test(text) || !/^[0-9 ()+-]+$/.test(text)) return value
  const national = text.replace(/^(?:\+351|00351)/, '')
  if (national.includes('+')) return value
  return national.replace(/[ ()-]/g, '')
}
