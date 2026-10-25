import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AppFrame from './AppFrame.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppFrame><App /></AppFrame>
  </StrictMode>,
)
