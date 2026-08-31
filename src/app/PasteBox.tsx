import { useState, type ChangeEvent, type DragEvent, type FormEvent } from "react"
import { CaretDown, CaretUp, CornersOut, UploadSimple } from "@phosphor-icons/react"
import { PRIVACY_CAVEAT_NOTE, PRIVACY_STATEMENT_SHORT } from "../privacy/copy"

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
 * The privacy statement lives directly below the input, not just in a
 * footer/docs link — the trust decision happens right here (see the PEV2
 * case in docs/07-additional-tool-limitations.md and the
 * privacy-architecture skill).
 *
 * Design review (post-Episode 19): reorganized to match the reference
 * mock — a compact drop target that collapses to a one-line "pasted · N
 * lines" summary once there's content (so a loaded plan doesn't leave a
 * wall of raw JSON sitting in the rail), and the Analyze button promoted
 * to sit directly under the input. The collapse is a pure CSS visibility
 * toggle, not a conditional unmount — the textarea (and its
 * `paste-textarea` test id/value) stays in the DOM either way, so drag/drop
 * and the file picker below still target the same element.
 *
 * The mock has nothing below the short privacy line — no caveat text, no
 * "don't save"/"clear saved data" controls. Those stay (Episode 17, Story
 * 17.1's privacy opt-out is a real, tested control, not decoration a mock
 * can just omit), tucked behind a small "Privacy & storage settings"
 * disclosure instead of sitting open by default, so the closed-by-default
 * view still matches the mock closely.
 */
export function PasteBox({ onAnalyze, initialText, dontSave, onDontSaveChange, hasSavedData, onClearSavedData }: PasteBoxProps) {
  const [text, setText] = useState(initialText ?? "")
  // Story 18.5 — visual affordance only (a highlighted dropzone while a
  // file is being dragged over it); not required by anything functional.
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  // Starts collapsed when a plan arrives pre-loaded (a restored share
  // link) — same "already loaded" state a sample/file pick lands in below.
  const [isCollapsed, setIsCollapsed] = useState(Boolean(initialText))
  // Tucked-away privacy/storage disclosure (design review) — closed by
  // default so the rail matches the mock's minimal look; the controls
  // inside are still fully functional once opened.
  const [showPrivacyDetails, setShowPrivacyDetails] = useState(false)

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (text.trim().length === 0) return
    onAnalyze(text)
    setIsCollapsed(true)
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
      setIsCollapsed(true)
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

  const lineCount = text.length === 0 ? 0 : text.split("\n").length
  const showCollapsedSummary = isCollapsed && text.trim().length > 0

  return (
    <form className="paste-box" onSubmit={handleSubmit}>
      <div className="paste-box__input-wrap">
        {/* Icon-only overlay — the actual hint text is the textarea's own
            native `placeholder` below; duplicating it here as a second
            text element would just repeat the same sentence twice.
            `pointer-events: none` so it never intercepts a click/drop
            meant for the textarea underneath. */}
        {text.length === 0 && <UploadSimple className="paste-box__dropzone-icon" weight="bold" aria-hidden="true" />}

        {/* Story 18.5 — the dropzone IS the existing textarea (no separate
            overlay element competing for the same space): dragging a file
            over it and dropping loads that file's text the same way typing
            would, while it stays a normal, always-available text input.
            Collapsing it (below) is a CSS-only visibility change, not a
            conditional unmount, so this stays the same element throughout —
            same test id, same value, drop/drag handlers never re-attached. */}
        <textarea
          className={[
            "paste-box__textarea",
            isDraggingOver && "paste-box__textarea--drag-over",
            showCollapsedSummary && "paste-box__textarea--collapsed",
          ]
            .filter(Boolean)
            .join(" ")}
          data-testid="paste-textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={() => setIsDraggingOver(false)}
          placeholder="Drop a .json, .xml, .sqlplan, or .txt file, or paste it here."
          rows={text.length === 0 ? 5 : 12}
          // Episode 18, Story 18.12, spec §5 `1k`: "drag-and-drop is not
          // offered as an interaction on touch" — a single, viewport-neutral
          // wording (not a mobile-vs-desktop branch) that stays literally
          // true everywhere: dragging IS still a real, working interaction
          // here on desktop (the handlers above are unconditional — touch
          // simply never fires HTML5 drag events at all, so there's no
          // functional behavior to gate), it's just not the PRIMARY
          // advertised path on a phone the way "Browse a file…" below is.
          aria-label="Paste your execution plan"
        />

        {showCollapsedSummary && (
          <button
            type="button"
            className="paste-box__collapsed-summary"
            data-testid="paste-box-expand"
            onClick={() => setIsCollapsed(false)}
          >
            <span className="paste-box__collapsed-summary-header">
              <span>
                pasted · {lineCount} {lineCount === 1 ? "line" : "lines"}
              </span>
              <CornersOut aria-hidden="true" />
            </span>
            {/* A read-only peek at the pasted content, same as the mock —
                purely decorative (the real, editable text lives in the
                hidden textarea above); cut off by the container's own
                max-height rather than truncated to N lines, so it reads as
                "there's more below" the same way the mock's does. */}
            <pre className="paste-box__collapsed-summary-preview" aria-hidden="true">
              {text}
            </pre>
          </button>
        )}
      </div>

      <div className="paste-box__file-row">
        {/* A styled label wrapping a visually-hidden file input — clicking
            anywhere on the label opens the native file picker, standard
            accessible pattern (no ref-driven synthetic click needed).
            Episode 18, Story 18.12: paste stays the PRIMARY input on
            mobile (this row is never hidden there), with this button as
            the secondary, always-reachable path — drag-and-drop needs no
            explicit mobile handling of its own since touch devices simply
            never fire HTML5 drag events in the first place; there's no
            broken/dead interaction to gate off, only a desktop-only one
            that was never reachable on touch to begin with. */}
        <label className="paste-box__file-button" data-testid="file-picker-label">
          or browse a file…
          <input
            type="file"
            accept=".json,.xml,.txt,text/plain,application/json,text/xml,application/xml"
            onChange={handleFileInputChange}
            data-testid="file-picker-input"
            className="paste-box__file-input"
          />
        </label>
      </div>

      <button type="submit" className="paste-box__submit" disabled={text.trim().length === 0}>
        Analyze plan
      </button>

      <p className="paste-box__privacy" data-testid="privacy-statement">
        {PRIVACY_STATEMENT_SHORT}
      </p>

      {/* Episode 17 — local persistence controls, and the caveat note, both
          tucked behind this disclosure (design review) rather than always
          open — the mock's rail has nothing below the privacy line, but
          the controls themselves are still a real, tested requirement
          (Story 17.1's "visible at the point of pasting, not buried in
          settings" — one click away still satisfies that, sitting open by
          default doesn't match the mock). */}
      <button
        type="button"
        className="paste-box__privacy-more-toggle"
        aria-expanded={showPrivacyDetails}
        data-testid="privacy-details-toggle"
        onClick={() => setShowPrivacyDetails((v) => !v)}
      >
        Privacy &amp; storage settings
        {showPrivacyDetails ? <CaretUp aria-hidden="true" /> : <CaretDown aria-hidden="true" />}
      </button>

      {showPrivacyDetails && (
        <div className="paste-box__privacy-details">
          <p className="paste-box__privacy-caveat" data-testid="privacy-caveat">
            {PRIVACY_CAVEAT_NOTE}
          </p>
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
        </div>
      )}
    </form>
  )
}
