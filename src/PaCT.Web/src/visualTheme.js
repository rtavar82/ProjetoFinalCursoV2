export const visualThemes = { sage: 'Sálvia e areia', rose: 'Rosa chá e ameixa', lavender: 'Lavanda e eucalipto' }
const key = 'pact.visualTheme'

export function isVisualTheme(theme) { return Object.hasOwn(visualThemes, theme) }

export function readVisualTheme() {
  try {
    const saved = localStorage.getItem(key)
    if (isVisualTheme(saved)) return saved
  } catch { /* The default also works when browser storage is unavailable. */ }
  return 'sage'
}

export function applyVisualTheme(theme) {
  document.documentElement.dataset.visualTheme = isVisualTheme(theme) ? theme : 'sage'
}

export function saveVisualTheme(theme) {
  if (!isVisualTheme(theme)) return
  try { localStorage.setItem(key, theme) } catch { /* Keep the current in-memory preference. */ }
}
