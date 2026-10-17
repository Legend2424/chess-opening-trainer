import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: '/chess-endgame-trainer/' makes it work under a GitHub Pages project path.
// For local dev and root-domain hosting (Netlify/Vercel) this is harmless.
export default defineConfig({
  base: process.env.DEPLOY_BASE ?? '/',
  plugins: [react()],
  // Stockfish ships as a classic web worker in /public; nothing special needed,
  // but we make sure Vite doesn't try to bundle it.
  worker: {
    format: 'es',
  },
})
