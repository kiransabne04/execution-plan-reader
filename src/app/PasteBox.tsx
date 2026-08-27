import { useState, type FormEvent } from "react"
import { PRIVACY_CAVEAT_NOTE, PRIVACY_STATEMENT_SHORT } from "../privacy/copy"
import { PASTE_BOX_PLACEHOLDER } from "./positioningCopy"

export interface PasteBoxProps {
  onAnalyze: (text: string) => void
  /** Pre-fills the textarea — used when a Story 11.2 shareable link decoded
   * successfully on load, so the recovered text is visible and re-copyable,
   * not just silently rendered into the graph below. */
  initialText?: string
}

/**
 * The privacy statement lives directly above the textarea, not just in a
 * footer/docs link — the trust decision happens right here (see the PEV2
 * case in docs/07-additional-tool-limitations.md and the
 * privacy-architecture skill).
 */
export function PasteBox({ onAnalyze, initialText }: PasteBoxProps) {
  const [text, setText] = useState(initialText ?? "")

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (text.trim().length === 0) return
    onAnalyze(text)
  }

  return (
    <form className="paste-box" onSubmit={handleSubmit}>
      <p className="paste-box__privacy" data-testid="privacy-statement">
        {PRIVACY_STATEMENT_SHORT}
      </p>
      <p className="paste-box__privacy-caveat" data-testid="privacy-caveat">
        {PRIVACY_CAVEAT_NOTE}
      </p>
      <textarea
        className="paste-box__textarea"
        data-testid="paste-textarea"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={PASTE_BOX_PLACEHOLDER}
        rows={12}
        aria-label="Paste your execution plan"
      />
      <button type="submit" className="paste-box__submit" disabled={text.trim().length === 0}>
        Analyze plan
      </button>
    </form>
  )
}
