import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `base` comes from DEPLOY_BASE: the GitHub Pages workflow sets it to "/<repo>/"
// (project pages live under a sub-path); locally and on a root domain it is "/".
// A missing trailing slash is added, so "/chess-opening-trainer" works too.
// Stockfish is a classic web worker loaded from public/engine/ (not bundled).
export default defineConfig({
  base: (process.env.DEPLOY_BASE ?? '/').replace(/\/?$/, '/'),
  plugins: [react()],
  build: {
    // The main chunk (React + chess.js + the trainer) is ~480 kB; warn only above 600.
    chunkSizeWarningLimit: 600,
  },
})
