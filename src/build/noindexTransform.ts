// SEO indexing infrastructure, Requirement 5: Vercel preview deployments
// must never compete with production in search results.
//
// Vercel sets `VERCEL_ENV` ("production" | "preview" | "development") as a
// build-time environment variable — read here, at BUILD time (inside a
// Vite `transformIndexHtml` hook — see `vite.config.ts` — never shipped to
// client JS, never exposed via `import.meta.env`), to bake an explicit
// `noindex, nofollow` meta tag into a non-production build's own
// `index.html`. This is the only mechanism that actually works for this
// project: `vercel.json`'s own `headers`/`redirects` config applies
// identically across every deployment (Vercel has no per-environment
// conditional syntax there), and there is no server-side request handling
// at all to do this per-request (a pure static SPA) — the ONE place
// production and preview builds genuinely differ is the build step itself,
// which is exactly where `VERCEL_ENV` is available.
//
// Local dev/build (`VERCEL_ENV` unset entirely) and real production
// (`VERCEL_ENV === "production"`) are both left untouched — this only
// fires for a genuine Vercel preview (or Vercel's own "development"
// environment value, treated the same as preview: neither is production).
export function injectNoindexForNonProduction(html: string, vercelEnv: string | undefined): string {
  if (vercelEnv === undefined || vercelEnv === "production") return html
  if (!html.includes("</head>")) return html
  return html.replace("</head>", '    <meta name="robots" content="noindex, nofollow" />\n  </head>')
}
