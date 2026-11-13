import { createContext, useContext } from 'react'

export const VisualThemeContext = createContext(null)

export function useVisualTheme() {
  const value = useContext(VisualThemeContext)
  if (!value) throw new Error('O tema global exige VisualThemeProvider na raiz da aplicação.')
  return value
}
