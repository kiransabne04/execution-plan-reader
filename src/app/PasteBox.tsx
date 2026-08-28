import { useState, type FormEvent } from "react"
import { PRIVACY_CAVEAT_NOTE, PRIVACY_STATEMENT_SHORT } from "../privacy/copy"
import { PASTE_BOX_PLACEHOLDER } from "./positioningCopy"

export interface PasteBoxProps {
  onAnalyze: (text: string) => void
  /** Pre-fills the textarea — used when a Story 11.2 shareable link decoded
   * successfully on load, so the recovered text is visible and re-copyable,
   * not just silently rendered into the graph below. */
  initialText?: string
  /** Episode 17, Story 17.1's "don't save this session" opt-out — lives
   * here, adjacent to the privacy statement, per the story's explicit edge
   * case: "visible at the point of pasting, not buried in settings." State
   * itself is owned by the parent (PlanReaderPage), since handleAnalyze —
   * not this component — decides whether to call the persistence layer. */
  dontSave: boolean
  onDontSaveChange: (value: boolean) => void
  /** The "clear saved data" control (same edge case) — only rendered when
   * there's actually something to clear, so it's not a dead button on a
   * fresh browser profile that's never saved anything. */
  hasSavedData: boolean
  onClearSavedData: () => void
}

/**
 * The privacy statement lives directly above the textarea, not just in a
 * footer/docs link — the trust decision happens right here (see the PEV2
 * case in docs/07-additional-tool-limitations.md and the
 * privacy-architecture skill).
 */
export function PasteBox({ onAnalyze, initialText, dontSave, onDontSaveChange, hasSavedData, onClearSavedData }: PasteBoxProps) {
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

      {/* Episode 17 — local persistence controls, at the same trust-decision
          moment as the privacy statement above. "Saved" only ever means
          "kept in this browser's own IndexedDB" — never sent anywhere, same
          promise the rest of this page makes; stated plainly here since the
          word alone can otherwise sound alarming (see the story's edge case). */}
      <div className="paste-box__persistence-controls">
        <label className="paste-box__dont-save">
          <input
            type="checkbox"
            checked={dontSave}
            onChange={(event) => onDontSaveChange(event.target.checked)}
            data-testid="dont-save-checkbox"
          />
          Don&apos;t save this plan in my browser (saved plans never leave your browser either way)
        </label>
        {hasSavedData && (
          <button
            type="button"
            className="paste-box__clear-saved"
            onClick={onClearSavedData}
            data-testid="clear-saved-data-button"
          >
            Clear saved data
          </button>
        )}
      </div>

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
