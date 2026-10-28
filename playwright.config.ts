import { defineConfig, devices } from '@playwright/test'

import { PAGES_BASE, PREVIEW_PORT } from './pages.config.ts'

// Drives the production build on its real GitHub Pages subpath, so the smoke
// test exercises the same asset paths the deployed site uses.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PREVIEW_PORT}${PAGES_BASE}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview:pages',
    url: `http://localhost:${PREVIEW_PORT}${PAGES_BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
