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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
