/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    // e2e/ holds Playwright specs (npm run test:e2e) — they import `test`/
    // `expect` from @playwright/test, not vitest, and must never be picked
    // up by vitest's own default *.spec.ts discovery.
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
})
