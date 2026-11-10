export const visualThemes = { sage: 'Sálvia e areia', rose: 'Rosa chá e ameixa', lavender: 'Lavanda e eucalipto' }
const key = 'pact.visualTheme'

export function readVisualTheme() {
  try {
    const saved = localStorage.getItem(key)
    if (Object.hasOwn(visualThemes, saved)) return saved
  } catch { /* The default also works when browser storage is unavailable. */ }
  return 'sage'
}

export function saveVisualTheme(theme) {
  try { localStorage.setItem(key, theme) } catch { /* Keep the current in-memory preference. */ }
}
