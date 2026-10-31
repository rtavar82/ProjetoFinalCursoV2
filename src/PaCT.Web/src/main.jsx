import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AppFrame from './AppFrame.jsx'
import { removeRetiredDraftStorage } from './removeRetiredDraftStorage'

removeRetiredDraftStorage()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppFrame><App /></AppFrame>
  </StrictMode>,
)
