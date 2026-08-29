import { useState, type FormEvent } from "react"
import { PRIVACY_CAVEAT_NOTE, PRIVACY_STATEMENT_SHORT } from "../privacy/copy"

export interface ComparePasteBoxProps {
  onAnalyze: (text: string) => void
  onCancel: () => void
}

/**
 * Episode 14, Story 14.2 — the second plan for a comparison. Deliberately
 * lighter than PasteBox: this plan is never persisted (Episode 17's local-
 * session-restore and recent-plans list, and Story 11.2's shareable link,
 * all stay scoped to the PRIMARY plan only — see PlanReaderPage.tsx), so
 * there's no "don't save"/"clear saved data" controls to duplicate here.
 * The privacy statement itself IS repeated — a second paste is a second
 * trust decision, not covered by having shown it once already.
 */
export function ComparePasteBox({ onAnalyze, onCancel }: ComparePasteBoxProps) {
  const [text, setText] = useState("")

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (text.trim().length === 0) return
    onAnalyze(text)
  }

  return (
    <form className="paste-box compare-paste-box" onSubmit={handleSubmit} data-testid="compare-paste-box">
      <div className="compare-paste-box__header">
        <p className="compare-paste-box__label">Paste the plan to compare against</p>
        <button type="button" className="compare-paste-box__cancel" data-testid="compare-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="paste-box__privacy">{PRIVACY_STATEMENT_SHORT}</p>
      <p className="paste-box__privacy-caveat">{PRIVACY_CAVEAT_NOTE}</p>
      <textarea
        className="paste-box__textarea"
        data-testid="compare-paste-textarea"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Paste a second execution plan…"
        rows={8}
        aria-label="Paste the plan to compare against"
      />
      <button type="submit" className="paste-box__submit" data-testid="compare-paste-submit" disabled={text.trim().length === 0}>
        Compare plans
      </button>
    </form>
  )
}
