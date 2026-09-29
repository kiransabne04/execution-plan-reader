import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './index.css'
import { SnowflakeLandingPage } from './app/SnowflakeLandingPage.tsx'
import { installNetworkGuard } from './privacy'

// Same privacy invariant as main.tsx — installed before anything else
// renders, with an empty allowlist.
installNetworkGuard()

// snowflake-query-profile-analyzer.html ships a static SEO snapshot
// already inside `#root` (see that file's own comment), so a non-JS
// crawler sees real content. `createRoot` doesn't clear pre-existing
// children on its own, so it's cleared explicitly before the real page
// mounts — same reasoning as main.tsx.
const container = document.getElementById('root')!
container.replaceChildren()

createRoot(container).render(
  <StrictMode>
    <SnowflakeLandingPage />
  </StrictMode>,
)
