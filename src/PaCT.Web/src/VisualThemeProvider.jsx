import { useLayoutEffect, useState } from 'react'
import { applyVisualTheme, isVisualTheme, readVisualTheme, saveVisualTheme } from './visualTheme'
import { VisualThemeContext } from './visualThemeContext'

export default function VisualThemeProvider({ children, initialTheme }) {
  const [theme, setTheme] = useState(() => isVisualTheme(initialTheme) ? initialTheme : readVisualTheme())
  useLayoutEffect(() => { applyVisualTheme(theme) }, [theme])

  function changeTheme(nextTheme) {
    if (!isVisualTheme(nextTheme)) return
    setTheme(nextTheme)
    saveVisualTheme(nextTheme)
  }

  return <VisualThemeContext.Provider value={{ theme, changeTheme }}>{children}</VisualThemeContext.Provider>
}
