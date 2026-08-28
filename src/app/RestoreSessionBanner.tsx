// Episode 17, Story 17.1's explicit acceptance criterion: "offers to
// restore the previous session — not silently auto-loads without asking."

export interface RestoreSessionBannerProps {
  savedAt: number
  onRestore: () => void
  onDismiss: () => void
}

export function RestoreSessionBanner({ savedAt, onRestore, onDismiss }: RestoreSessionBannerProps) {
  const when = new Date(savedAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <div className="restore-session-banner" role="status" data-testid="restore-session-banner">
      <p className="restore-session-banner__text">
        We found a plan you were looking at before ({when}). Restore it?
      </p>
      <div className="restore-session-banner__actions">
        <button type="button" className="restore-session-banner__restore" onClick={onRestore} data-testid="restore-session-button">
          Restore
        </button>
        <button type="button" className="restore-session-banner__dismiss" onClick={onDismiss} data-testid="dismiss-restore-button">
          Dismiss
        </button>
      </div>
    </div>
  )
}
