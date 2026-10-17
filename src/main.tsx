import React from 'react'
import ReactDOM from 'react-dom/client'
// Global styles first, so each screen's own CSS (imported by App) can override them.
import './styles/global.css'
import App from './App.tsx'

// A screen's code chunk failed to load — almost always because a new version
// was deployed while the app was open (old file names are gone). Reload once to
// pick up the new version; if it fails again right away, let the ErrorBoundary
// show its "Restart" card instead of looping.
const RELOAD_FLAG = 'opening-quest.chunk-reload'
window.addEventListener('vite:preloadError', (e) => {
  let reloadedRecently = false
  try {
    const at = Number(sessionStorage.getItem(RELOAD_FLAG) ?? '0')
    reloadedRecently = Date.now() - at < 30_000
    if (!reloadedRecently) sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
  } catch {
    reloadedRecently = false
  }
  if (reloadedRecently) return
  e.preventDefault()
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
