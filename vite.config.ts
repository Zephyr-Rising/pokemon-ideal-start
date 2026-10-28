import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { PAGES_BASE } from './pages.config.ts'

export default defineConfig(({ mode }) => ({
  // Local dev serves from the root; `--mode pages` builds for the GitHub Pages
  // subpath. Preflight previews that same mode, so the deployed asset paths are
  // exercised before anything ships.
  base: mode === 'pages' ? PAGES_BASE : '/',
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    // The bundle is dominated by the 560 kB card database, which the app needs
    // before it can resolve any decklist — so there is nothing useful to split
    // out and no loading state worth introducing. 153 kB gzipped in one request.
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}))
