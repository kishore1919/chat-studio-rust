import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initTheme } from './store/theme'

// Must run before render: index.html's inline script sets `data-theme`
// pre-paint from localStorage alone, and deferring this into a React effect
// would reintroduce a flash of the wrong palette between paint and the
// effect running.
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
