import { useState, type ChangeEvent, type DragEvent, type FormEvent } from "react"
import { ArrowsOutSimple, CaretDown, CaretUp, UploadSimple } from "@phosphor-icons/react"
import { PRIVACY_CAVEAT_NOTE, PRIVACY_STATEMENT_SHORT } from "../privacy/copy"
import { SAMPLE_FIXTURES } from "./sampleFixtures"

export interface PasteBoxProps {
  /** `filename` is a real name (a dropped/picked file's own name, or a
   * loaded sample's actual filename) — omitted for plain paste, never a
   * fabricated one. See PlanReaderPage.tsx's own `sourceFilename` state
   * and the app-bar's filename slot (design review, header PNG reference). */
  onAnalyze: (text: string, filename?: string) => void
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
      onAnalyze(fileText, file.name)
      setIsCollapsed(true)
    } catch {
      // A real file-read failure (permissions, a mid-read device error) is
      // rare and distinct from "this isn't a valid plan" — analyzePlanText
      // never even runs, so there's nothing for the existing parse-error
      // channel to report. Left as a silent no-op rather than inventing a
      // second error-display path for an edge case this unlikely.
    }
  }

  // Design review, spec §6 `1d`: same "paste and go" treatment the file
  // picker already gets above — visible in the (re-editable) textarea AND
  // handed straight to `onAnalyze`, not a second, silent load path.
  const loadSample = (sampleText: string, filename: string) => {
    setText(sampleText)
    onAnalyze(sampleText, filename)
    setIsCollapsed(true)
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

  // Pixel-match pass against the downloaded left-sidebar mockup (its own
  // saved source — the same reference spec §2 "2a fluid shell" the rest of
  // this shell already follows): the dropzone there is a compact, ALWAYS-
  // visible single-row bar — icon, format list, and an inline "browse"
  // link all in one line — not a full-height placeholder box shown only
  // while empty. It renders whenever there's no in-progress edit to hide
  // it behind: while empty (overlaid on the compact textarea beneath, so
  // dropping/typing still reaches that same element per Story 18.5) or
  // once collapsed (a plain block above the pasted-content summary, so
  // dropping a replacement file or picking one stays reachable without
  // first re-expanding). It hides only mid-edit (text typed/pasted but not
  // yet submitted) — same as the icon-only overlay this replaces — so it
  // never sits on top of what the user is actively looking at.
  const showDropzone = text.length === 0 || showCollapsedSummary

  return (
    <form className="paste-box" onSubmit={handleSubmit}>
      <div className="paste-box__input-wrap">
        {showDropzone && (
          <div
            className={[
              "paste-box__dropzone",
              text.length === 0 ? "paste-box__dropzone--overlay" : "paste-box__dropzone--static",
              // The textarea's own drag handlers (below) still fire through
              // this click-through overlay (Story 18.5) — but its own
              // border is transparent while overlaid (see .paste-box__
              // textarea:placeholder-shown), so the drag-over cue has to
              // render on the overlay itself instead, or it'd be invisible.
              text.length === 0 && isDraggingOver && "paste-box__dropzone--drag-over",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {/* Design tokens spec: "Phosphor, regular weight, fill only
                for the brand mark" — the mockup's own saved source
                confirms plain `ph-upload-simple` (regular), not a bold
                modifier. Decorative: the textarea's own `placeholder`
                (below) carries the accessible text. */}
            <UploadSimple className="paste-box__dropzone-icon" aria-hidden="true" />
            <span className="paste-box__dropzone-text" aria-hidden="true">
              Drop <span className="paste-box__dropzone-formats">.json .xml .sqlplan .txt</span> or
            </span>
            {/* A styled label wrapping a visually-hidden file input —
                clicking anywhere on it opens the native file picker,
                standard accessible pattern (no ref-driven synthetic click
                needed). Real pointer events even while the dropzone as a
                whole is a click-through overlay (below) — see that
                modifier's own CSS comment. Episode 18, Story 18.12: paste
                stays the PRIMARY input on mobile, with this as the
                secondary, always-reachable path — drag-and-drop needs no
                explicit mobile handling since touch devices simply never
                fire HTML5 drag events in the first place. */}
            <label className="paste-box__dropzone-browse" data-testid="file-picker-label">
              browse
              <input
                type="file"
                accept=".json,.xml,.txt,text/plain,application/json,text/xml,application/xml"
                onChange={handleFileInputChange}
                data-testid="file-picker-input"
                className="paste-box__file-input"
              />
            </label>
          </div>
        )}

        {/* Story 18.5 — the dropzone IS the existing textarea while empty
            (no separate overlay element competing for the same space):
            dragging a file over it and dropping loads that file's text the
            same way typing would, while it stays a normal, always-available
            text input. Collapsing it (below) is a CSS-only visibility
            change, not a conditional unmount, so this stays the same
            element throughout — same test id, same value, drop/drag
            handlers never re-attached. */}
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
          rows={text.length === 0 ? 1 : 12}
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
              <ArrowsOutSimple aria-hidden="true" />
            </span>
            {/* A read-only peek at the pasted content, same as the mock —
                purely decorative (the real, editable text lives in the
                hidden textarea above); faded out by a mask-image (not an
                abrupt cutoff) so it reads as "there's more below" exactly
                the way the mock's own does. */}
            <pre className="paste-box__collapsed-summary-preview" aria-hidden="true">
              {text}
            </pre>
          </button>
        )}
      </div>

      <button type="submit" className="paste-box__submit" disabled={text.trim().length === 0}>
        Analyze plan
      </button>

      <p className="paste-box__privacy" data-testid="privacy-statement">
        {PRIVACY_STATEMENT_SHORT}
      </p>

      {/* Design review, spec §6 `1d`: "No plan handy? Start from a
          sample" — one real fixture per engine (sampleFixtures.ts),
          hidden once a plan is actually loaded/pasted, same as the mock
          (which only shows this on the empty landing state). */}
      {!showCollapsedSummary && (
        <div className="paste-box__samples" data-testid="sample-plan-list">
          <span className="paste-box__samples-label">No plan handy? Start from a sample</span>
          {SAMPLE_FIXTURES.map((sample) => (
            <button
              key={sample.engine}
              type="button"
              className="paste-box__sample-button"
              data-testid="sample-plan-button"
              onClick={() => loadSample(sample.text, sample.filename)}
            >
              <span className="paste-box__sample-engine">{sample.engineLabel}</span>
              <span className="paste-box__sample-description">— {sample.description}</span>
              <span className="paste-box__sample-format">{sample.formatLabel}</span>
            </button>
          ))}
        </div>
      )}

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
