import React from 'react'
import ReactDOM from 'react-dom/client'
// Global styles first, so each screen's own CSS (imported by App) can override them.
import './styles/global.css'
import App from './App.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
