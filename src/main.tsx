import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './index.css'
import App from './App.tsx'
import { installNetworkGuard } from './privacy'

// Structural enforcement of the privacy promise (see
// .claude/skills/privacy-architecture/SKILL.md): installed before anything
// else renders, with an empty allowlist — nothing in the app is opt-in yet
// (Episodes 10/11), so every outbound call is blocked by default.
installNetworkGuard()

// User-directed SEO follow-up: index.html's `#root` ships with a static
// SEO snapshot already inside it (see that file's own comment) so a
// non-JS crawler sees real content instead of an empty div. `createRoot`
// does not clear pre-existing children on its own — it would otherwise
// leave the static snapshot sitting alongside the real app, duplicated,
// once React mounts. Cleared explicitly, deterministically, before the
// real app ever renders.
const container = document.getElementById('root')!
container.replaceChildren()

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
