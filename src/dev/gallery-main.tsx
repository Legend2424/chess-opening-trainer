// Entry point for /gallery.html (dev-only UI kit showcase).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/global.css'
import { ToastProvider } from '../components/ui/index.ts'
import UiGallery from './UiGallery.tsx'

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(
    <StrictMode>
      <ToastProvider>
        <UiGallery />
      </ToastProvider>
    </StrictMode>,
  )
}
