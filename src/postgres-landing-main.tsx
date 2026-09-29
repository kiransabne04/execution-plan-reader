import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './index.css'
import { PostgresLandingPage } from './app/PostgresLandingPage.tsx'
import { installNetworkGuard } from './privacy'

// Same privacy invariant as main.tsx — installed before anything else
// renders, with an empty allowlist.
installNetworkGuard()

// postgresql-execution-plan-analyzer.html ships a static SEO snapshot
// already inside `#root` (see that file's own comment), so a non-JS
// crawler sees real content. `createRoot` doesn't clear pre-existing
// children on its own, so it's cleared explicitly before the real page
// mounts — same reasoning as main.tsx.
const container = document.getElementById('root')!
container.replaceChildren()

createRoot(container).render(
  <StrictMode>
    <PostgresLandingPage />
  </StrictMode>,
)
