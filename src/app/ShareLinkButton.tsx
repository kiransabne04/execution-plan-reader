import { useState } from "react"
import { Link } from "@phosphor-icons/react"
import { encodeShareLink } from "./shareLink"

export interface ShareLinkButtonProps {
  /** The exact raw text currently analyzed — re-encoded fresh on each click
   * so the link always matches what's on screen, not a stale snapshot. */
  rawText: string
}

type Status = "idle" | "copied" | "copy_failed" | "too_large"

/**
 * Story 11.2 — the client-side-only shareable link. Encodes `rawText` into
 * a URL fragment (never a query parameter — see shareLink.ts) and copies it
 * to the clipboard. Never fails silently: a plan too large for a reliable
 * link-only share, or a clipboard write that's blocked (permissions,
 * insecure context), both surface an explicit message rather than doing
 * nothing.
 */
export function ShareLinkButton({ rawText }: ShareLinkButtonProps) {
  const [status, setStatus] = useState<Status>("idle")
  const [builtUrl, setBuiltUrl] = useState<string | null>(null)

  const handleClick = async () => {
    const result = encodeShareLink(rawText)
    if (!result.ok) {
      setStatus("too_large")
      setBuiltUrl(null)
      return
    }
    setBuiltUrl(result.url)
    try {
      await navigator.clipboard.writeText(result.url)
      setStatus("copied")
    } catch {
      setStatus("copy_failed")
    }
  }

  return (
    <div className="share-link">
      {/* Spec §2: "Share and Export drop to icon-only before wrapping" —
          see planReaderPage.css's own comment for the measured breakpoint.
          `aria-label` carries the accessible name regardless of whether
          the text label is visually hidden. */}
      <button type="button" className="share-link__button" onClick={handleClick} aria-label="Copy shareable link">
        <Link className="share-link__button-icon" weight="regular" aria-hidden="true" />
        <span className="share-link__button-label">Copy shareable link</span>
      </button>

      {status === "copied" && (
        <p className="share-link__message" role="status" data-testid="share-link-copied">
          Link copied to clipboard — nothing was sent to any server to create it.
        </p>
      )}

      {status === "copy_failed" && builtUrl && (
        <p className="share-link__message" data-testid="share-link-manual">
          Couldn't copy automatically — copy this link manually:
          <input
            type="text"
            className="share-link__url-input"
            readOnly
            value={builtUrl}
            data-testid="share-link-url-input"
            onFocus={(event) => event.currentTarget.select()}
          />
        </p>
      )}

      {status === "too_large" && (
        <p className="share-link__message share-link__message--warning" role="alert" data-testid="share-link-too-large">
          This plan is too large for a link-only share.
        </p>
      )}
    </div>
  )
}
