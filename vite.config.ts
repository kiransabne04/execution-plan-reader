/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { injectNoindexForNonProduction } from './src/build/noindexTransform.ts'

// SEO indexing infrastructure, Requirement 5 (see
// src/build/noindexTransform.ts's own doc comment for the full
// reasoning): bakes a noindex/nofollow meta tag into index.html at build
// time for any non-production Vercel build (preview/development), so a
// preview deployment can never compete with production in search results.
// A real Vite plugin (not a postbuild script) so it participates in both
// `vite build` (production/preview deploys) and `vite dev`/`vite preview`
// via the same `transformIndexHtml` hook, with no separate build step to
// keep in sync.
function noindexOnVercelPreview(): Plugin {
  return {
    name: 'noindex-on-vercel-preview',
    transformIndexHtml(html) {
      return injectNoindexForNonProduction(html, process.env.VERCEL_ENV)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), noindexOnVercelPreview()],
  build: {
    // Episode SEO-03: real, separate static URLs per product landing page
    // (own title/meta/JSON-LD/static content, not a client-side route) —
    // a Vite multi-page build, one root-level `.html` entry per page.
    // `noindexOnVercelPreview`'s `transformIndexHtml` hook runs against
    // every entry listed here, so the preview-noindex guarantee already
    // covers new pages added this way with no page-specific change.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        postgresLanding: fileURLToPath(new URL('./postgresql-execution-plan-analyzer.html', import.meta.url)),
        sqlServerLanding: fileURLToPath(new URL('./sql-server-execution-plan-analyzer.html', import.meta.url)),
        snowflakeLanding: fileURLToPath(new URL('./snowflake-query-profile-analyzer.html', import.meta.url)),
      },
    },
  },
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
