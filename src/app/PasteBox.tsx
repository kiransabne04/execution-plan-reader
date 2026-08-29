import { useState, type ChangeEvent, type DragEvent, type FormEvent } from "react"
import { PRIVACY_CAVEAT_NOTE, PRIVACY_STATEMENT_SHORT } from "../privacy/copy"
import { PASTE_BOX_PLACEHOLDER } from "./positioningCopy"
import { SAMPLE_PLANS } from "./samplePlans"

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

/** Story 18.5 — reads a dropped/picked File entirely client-side and hands
 * the text to the SAME `onAnalyze` callback a paste already uses — no new
 * parse path, no upload, no `fetch`/`XMLHttpRequest` anywhere in this flow
 * (privacy-architecture skill). A binary or non-plan file just produces
 * garbage text that `analyzePlanText` already rejects with its existing
 * friendly `PlanParseError` — that path doesn't need a second, divergent
 * error case built for it here. */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
    reader.onerror = () => reject(reader.error ?? new Error("File could not be read."))
    reader.readAsText(file)
  })
}

/**
 * The privacy statement lives directly above the textarea, not just in a
 * footer/docs link — the trust decision happens right here (see the PEV2
 * case in docs/07-additional-tool-limitations.md and the
 * privacy-architecture skill).
 */
export function PasteBox({ onAnalyze, initialText, dontSave, onDontSaveChange, hasSavedData, onClearSavedData }: PasteBoxProps) {
  const [text, setText] = useState(initialText ?? "")
  // Story 18.5 — visual affordance only (a highlighted dropzone while a
  // file is being dragged over it); not required by anything functional.
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (text.trim().length === 0) return
    onAnalyze(text)
  }

  // Loads a File's text into both the textarea (visible, re-copyable — same
  // treatment a recovered share link already gets) and straight into
  // analysis, matching the existing "paste and go" flow rather than
  // requiring an extra click on the Analyze button too.
  const loadFile = async (file: File) => {
    // Reading is inherently async, but genuinely fast even at a few MB —
    // Story 16.2 already measured this class of "is a Web Worker
    // warranted" question for the paste path and concluded no without
    // evidence of a real freeze; nothing here suggests file reads are any
    // different, so this doesn't add a loading spinner for what would be a
    // sub-second wait in the overwhelming majority of real files.
    try {
      const fileText = await readFileAsText(file)
      setText(fileText)
      onAnalyze(fileText)
    } catch {
      // A real file-read failure (permissions, a mid-read device error) is
      // rare and distinct from "this isn't a valid plan" — analyzePlanText
      // never even runs, so there's nothing for the existing parse-error
      // channel to report. Left as a silent no-op rather than inventing a
      // second error-display path for an edge case this unlikely.
    }
  }

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = "" // lets picking the SAME file again still fire onChange
    if (file) void loadFile(file)
  }

  const handleDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    event.preventDefault()
    setIsDraggingOver(false)
    const file = event.dataTransfer.files[0]
    if (file) void loadFile(file)
  }

  const handleDragOver = (event: DragEvent<HTMLTextAreaElement>) => {
    event.preventDefault() // required for the drop event to fire at all
    setIsDraggingOver(true)
  }

  const handleSampleClick = (sampleText: string) => {
    setText(sampleText)
    onAnalyze(sampleText)
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

      {/* Story 18.5 — the dropzone IS the existing textarea (no separate
          overlay element competing for the same space): dragging a file
          over it and dropping loads that file's text the same way typing
          would, while it stays a normal, always-available text input.
          `accept` is advisory only (browsers don't enforce plan-format
          extensions) — the real validation is the same `analyzePlanText`
          every other input path already goes through. */}
      <textarea
        className={isDraggingOver ? "paste-box__textarea paste-box__textarea--drag-over" : "paste-box__textarea"}
        data-testid="paste-textarea"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDraggingOver(false)}
        placeholder={PASTE_BOX_PLACEHOLDER}
        rows={12}
        aria-label="Paste your execution plan, or drag a file onto this box"
      />

      <div className="paste-box__file-row">
        {/* A styled label wrapping a visually-hidden file input — clicking
            anywhere on the label opens the native file picker, standard
            accessible pattern (no ref-driven synthetic click needed). Drag-
            and-drop is meaningless on touch (Story 18.12 hides this whole
            row below the mobile breakpoint); this button is the reachable
            path there regardless. */}
        <label className="paste-box__file-button" data-testid="file-picker-label">
          Browse a file…
          <input
            type="file"
            accept=".json,.xml,.txt,text/plain,application/json,text/xml,application/xml"
            onChange={handleFileInputChange}
            data-testid="file-picker-input"
            className="paste-box__file-input"
          />
        </label>

        <div className="paste-box__samples">
          <span className="paste-box__samples-label">Try a sample:</span>
          {SAMPLE_PLANS.map((sample) => (
            <button
              key={sample.engine}
              type="button"
              className="paste-box__sample-button"
              data-testid={`sample-plan-${sample.engine}`}
              onClick={() => handleSampleClick(sample.text)}
            >
              {sample.label}
            </button>
          ))}
        </div>
      </div>

      <button type="submit" className="paste-box__submit" disabled={text.trim().length === 0}>
        Analyze plan
      </button>
    </form>
  )
}
