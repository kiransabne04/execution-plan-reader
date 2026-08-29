// Episode 18, Story 18.6 — spec §5 `1e`'s three severity treatments: "red
// left-rule = can't proceed; amber = partial result available; blurple =
// informational." One shared component so every notice in the app (a
// blocking parse error, the query-text-redacted caveat, the parameter-
// sensitivity/estimate-only honesty notes) reads as the same KIND of
// signal, not three independently-styled one-offs. Each severity carries
// both a color AND a text label — never color alone (the same rule the
// mismatch/severity-ring node encoding already follows — see the
// graph-visualization skill).

import type { ReactNode } from "react"

export type NoticeSeverity = "critical" | "warning" | "info"

const NOTICE_LABEL: Record<NoticeSeverity, string> = {
  critical: "Can't proceed",
  warning: "Partial result",
  info: "Note",
}

export interface NoticeProps {
  severity: NoticeSeverity
  children: ReactNode
  /** "alert" for a critical notice that should interrupt assistive tech
   * (a blocking error) — the default; other severities are informational,
   * not interruptions, so they don't carry the same urgency to a screen
   * reader. */
  role?: "alert" | "status"
  "data-testid"?: string
}

export function Notice({ severity, children, role, "data-testid": testId }: NoticeProps) {
  return (
    <p
      className={`plan-reader-page__notice plan-reader-page__notice--${severity}`}
      role={role ?? (severity === "critical" ? "alert" : "status")}
      data-testid={testId}
    >
      <span className="plan-reader-page__notice-label">{NOTICE_LABEL[severity]}:</span> {children}
    </p>
  )
}
