import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AppFrame from './AppFrame.jsx'
import VisualThemeProvider from './VisualThemeProvider'
import { applyVisualTheme, readVisualTheme } from './visualTheme'
import { prepareInitialEntry } from './initialEntry'
import { removeRetiredDraftStorage } from './removeRetiredDraftStorage'

prepareInitialEntry()
removeRetiredDraftStorage()
const initialTheme = readVisualTheme()
applyVisualTheme(initialTheme)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <VisualThemeProvider initialTheme={initialTheme}><AppFrame><App /></AppFrame></VisualThemeProvider>
  </StrictMode>,
)
