import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PlanReaderPage, SESSION_SAVE_DEBOUNCE_MS } from "../PlanReaderPage"
import { encodeShareLink } from "../shareLink"
import { _deleteDatabaseForTests, saveSession, addRecentPlan } from "../../persistence"

/** Waits out the real debounce window handleAnalyze's session-save goes
 * through, plus a small margin — used only where a test needs a save
 * triggered through the real UI flow to have actually landed in IndexedDB
 * before proceeding (e.g. before unmounting and remounting to check
 * restore behavior). Tests that only care about the RESTORE side of the
 * flow seed data directly via saveSession() instead — faster, and doesn't
 * conflate two different things being tested. */
function flushSessionSaveDebounce() {
  return new Promise((resolve) => setTimeout(resolve, SESSION_SAVE_DEBOUNCE_MS + 100))
}

function loadFixture(engine: string, filename: string): string {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../fixtures/${engine}`)
  return readFileSync(path.join(dir, filename), "utf-8")
}

// Episode 17: PlanReaderPage now touches the local persistence layer
// (IndexedDB, faked in tests — see src/__tests__/setup.ts) on every
// successful analyze. Without this, one test's save could bleed into the
// next test's fresh <PlanReaderPage /> mount (e.g. an unexpected restore
// banner), since fake-indexeddb's in-memory database otherwise persists
// across tests within the same file.
beforeEach(async () => {
  await _deleteDatabaseForTests()
})
afterEach(async () => {
  await _deleteDatabaseForTests()
})

function pasteAndAnalyze(text: string) {
  fireEvent.change(screen.getByTestId("paste-textarea"), { target: { value: text } })
  fireEvent.click(screen.getByRole("button", { name: /analyze plan/i }))
}

describe("PlanReaderPage", () => {
  it("renders the h1 headline containing 'execution plan', not just the brand name", () => {
    render(<PlanReaderPage />)
    const heading = screen.getByRole("heading", { level: 1 })
    expect(heading).toHaveTextContent(/execution plan/i)
  })

  it("shows the subheadline and all three supported engine names above the fold, immediately (no loading gate)", () => {
    render(<PlanReaderPage />)
    expect(screen.getByText(/Works with Postgres, SQL Server, and Snowflake/)).toBeInTheDocument()
    expect(screen.getByText("Postgres")).toBeInTheDocument()
    expect(screen.getByText("SQL Server")).toBeInTheDocument()
    expect(screen.getByText("Snowflake")).toBeInTheDocument()
  })

  it("shows a footer connecting the tool to Kiran's existing content, for first-time-visitor credibility", () => {
    render(<PlanReaderPage />)
    expect(screen.getByText(/scalingbackend/i)).toBeInTheDocument()
  })

  it("shows the privacy statement (and the browser-extension caveat) at the paste box before anything is analyzed", () => {
    render(<PlanReaderPage />)
    expect(screen.getByTestId("privacy-statement")).toBeInTheDocument()
    expect(screen.getByTestId("privacy-caveat")).toHaveTextContent(/browser extensions/i)
    expect(screen.queryByTestId("plan-result")).not.toBeInTheDocument()
  })

  it("analyzes a pasted Postgres plan and renders the summary + graph", () => {
    render(<PlanReaderPage />)
    pasteAndAnalyze(loadFixture("postgres", "multi-way-join.json"))

    expect(screen.getByTestId("plan-result")).toBeInTheDocument()
    expect(screen.getByTestId("detected-engine-badge")).toHaveTextContent("Postgres")
    expect(screen.getByTestId("plan-summary")).toBeInTheDocument()
    expect(screen.getAllByTestId("plan-node-card").length).toBeGreaterThan(0)
    expect(screen.queryByTestId("parse-error")).not.toBeInTheDocument()
  })

  it("shows a friendly error, not a crash, for pasted non-plan text", () => {
    render(<PlanReaderPage />)
    pasteAndAnalyze(loadFixture("postgres", "non-plan-text.txt"))

    expect(screen.getByTestId("parse-error")).toBeInTheDocument()
    expect(screen.queryByTestId("plan-result")).not.toBeInTheDocument()
  })

  it("clears a previous error once a valid plan is analyzed", () => {
    render(<PlanReaderPage />)
    pasteAndAnalyze(loadFixture("postgres", "non-plan-text.txt"))
    expect(screen.getByTestId("parse-error")).toBeInTheDocument()

    pasteAndAnalyze(loadFixture("postgres", "simple-seq-scan.json"))
    expect(screen.queryByTestId("parse-error")).not.toBeInTheDocument()
    expect(screen.getByTestId("plan-result")).toBeInTheDocument()
  })

  it("shows statement tabs for a multi-statement SQL Server batch and switches between them", () => {
    render(<PlanReaderPage />)
    pasteAndAnalyze(loadFixture("sqlserver", "multi-statement-batch.xml"))

    const tabs = screen.getAllByRole("tab")
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveAttribute("aria-selected", "true")

    fireEvent.click(tabs[1])
    expect(tabs[1]).toHaveAttribute("aria-selected", "true")
    expect(tabs[0]).toHaveAttribute("aria-selected", "false")
  })

  it("does not show statement tabs for a single-statement plan", () => {
    render(<PlanReaderPage />)
    pasteAndAnalyze(loadFixture("postgres", "simple-seq-scan.json"))
    expect(screen.queryByRole("tab")).not.toBeInTheDocument()
  })

  it("shows the redacted-query-text note for Snowflake plans with redaction enabled", () => {
    render(<PlanReaderPage />)
    pasteAndAnalyze(loadFixture("snowflake", "redacted-query-text.json"))
    expect(screen.getByText(/redacted by account policy/i)).toBeInTheDocument()
  })

  // Story 13.1 — the "All findings" list, wired end-to-end into the real page.
  it("expanding the findings list and clicking an entry opens that node's detail panel in the graph", () => {
    render(<PlanReaderPage />)
    pasteAndAnalyze(loadFixture("postgres", "initplan-subplan.json"))

    expect(screen.queryByTestId("detail-panel")).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId("findings-list-toggle"))
    const items = screen.getAllByTestId("finding-item")
    expect(items.length).toBeGreaterThan(0)

    fireEvent.click(items[0])
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument()
    expect(screen.getByTestId("warning-item")).toBeInTheDocument()
  })

  // Episode 16, Story 16.2 audit finding: a pathologically deep (not
  // wide) plan — a long single-child chain — can exceed the JS call
  // stack in the parser's recursive descent (buildNode in
  // parseJsonPlan.ts and equivalents recurse per tree level, one JS
  // stack frame per node depth). This is environment-dependent (the exact
  // depth that overflows varies by engine/stack size) and unlikely for a
  // real query plan (real plans are typically wide/branching, not
  // thousands of nodes deep in a straight line) — not fixed this pass
  // (would mean converting every recursive tree-walker across all three
  // parsers to iterative, a much larger, separate refactor), but it must
  // degrade to the same friendly generic error every other parse failure
  // gets, never a blank page or an error escaping the try/catch in
  // handleAnalyze. This test uses a depth (50,000) chosen to reliably
  // overflow in any realistic JS engine stack size, so it's a stable
  // regression check, not a flaky boundary probe.
  it("degrades to the friendly generic error, not a crash or blank page, for a pathologically deep (stack-overflowing) plan shape", () => {
    render(<PlanReaderPage />)

    let node: Record<string, unknown> = { "Node Type": "Seq Scan", "Total Cost": 1, "Plan Rows": 1, "Plan Width": 8 }
    for (let i = 0; i < 50_000; i++) {
      node = { "Node Type": "Nested Loop", "Total Cost": 10, "Plan Rows": 10, "Plan Width": 8, Plans: [node] }
    }
    const deepPlanJson = JSON.stringify([{ Plan: node }])

    expect(() => pasteAndAnalyze(deepPlanJson)).not.toThrow()
    expect(screen.getByTestId("parse-error")).toBeInTheDocument()
    expect(screen.queryByTestId("plan-result")).not.toBeInTheDocument()
  })

  // Episode 16, Story 16.2 edge case: "just handling a multi-MB paste
  // event can itself cause a noticeable stutter — confirm the paste-
  // handling path itself is profiled, not only the parser's own execution
  // time." Audited: PasteBox's onChange is a plain controlled-input
  // setState — no per-keystroke validation or transformation, so the cost
  // of a large paste is exactly one O(n) string copy into React state,
  // inherent to any controlled-textarea implementation. This test locks
  // in that a multi-MB paste completes the change event in bounded time,
  // separately from the subsequent parse (already covered by
  // analyzePlanPerformance.test.ts).
  it("a multi-MB paste into the textarea completes in bounded time, independent of the subsequent parse", () => {
    render(<PlanReaderPage />)
    const hugeText = "x".repeat(5_000_000) // 5MB, well beyond any real pasted plan

    const start = performance.now()
    fireEvent.change(screen.getByTestId("paste-textarea"), { target: { value: hugeText } })
    const elapsed = performance.now() - start

    expect(screen.getByTestId("paste-textarea")).toHaveValue(hugeText)
    expect(elapsed).toBeLessThan(1000)
  })

  it("disables the analyze button until something is pasted", () => {
    render(<PlanReaderPage />)
    expect(screen.getByRole("button", { name: /analyze plan/i })).toBeDisabled()
    fireEvent.change(screen.getByTestId("paste-textarea"), { target: { value: "x" } })
    expect(screen.getByRole("button", { name: /analyze plan/i })).not.toBeDisabled()
  })
})

// Story 11.2 — client-side-only shareable link, wired end-to-end.
describe("PlanReaderPage — shareable link (Story 11.2)", () => {
  afterEach(() => {
    window.location.hash = ""
  })

  it("renders the recovered plan directly on load when the URL has a valid share-link fragment — no re-paste/re-click needed", () => {
    const text = loadFixture("postgres", "simple-seq-scan.json")
    const encoded = encodeShareLink(text, "https://example.com/")
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    window.location.hash = encoded.url.split("#")[1]

    render(<PlanReaderPage />)

    expect(screen.getByTestId("plan-result")).toBeInTheDocument()
    expect(screen.getByTestId("detected-engine-badge")).toHaveTextContent("Postgres")
    expect(screen.queryByTestId("parse-error")).not.toBeInTheDocument()
    // The recovered text is also visible in the paste box, not just silently
    // rendered into the graph.
    expect(screen.getByTestId("paste-textarea")).toHaveValue(text)
  })

  it("shows a plain 'looks incomplete' message, not a crash or blank page, for a truncated/mangled share-link fragment", () => {
    const encoded = encodeShareLink("some plan text", "https://example.com/")
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const fullFragment = encoded.url.split("#")[1]
    window.location.hash = fullFragment.slice(0, Math.floor(fullFragment.length / 2))

    render(<PlanReaderPage />)

    expect(screen.getByTestId("parse-error")).toHaveTextContent(/incomplete|corrupted/i)
    expect(screen.queryByTestId("plan-result")).not.toBeInTheDocument()
  })

  it("makes no attempt at share-link recovery on an ordinary visit with no fragment at all", () => {
    render(<PlanReaderPage />)
    expect(screen.queryByTestId("parse-error")).not.toBeInTheDocument()
    expect(screen.queryByTestId("plan-result")).not.toBeInTheDocument()
    expect(screen.getByTestId("paste-textarea")).toHaveValue("")
  })

  it("copies a shareable link to the clipboard when clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<PlanReaderPage />)
    pasteAndAnalyze(loadFixture("postgres", "simple-seq-scan.json"))

    fireEvent.click(screen.getByRole("button", { name: /copy shareable link/i }))

    await waitFor(() => expect(screen.getByTestId("share-link-copied")).toBeInTheDocument())
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toContain("#plan=")
  })

  it("falls back to a manually-copyable link when the clipboard write is rejected (e.g. blocked by permissions)", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"))
    Object.assign(navigator, { clipboard: { writeText } })

    render(<PlanReaderPage />)
    pasteAndAnalyze(loadFixture("postgres", "simple-seq-scan.json"))
    fireEvent.click(screen.getByRole("button", { name: /copy shareable link/i }))

    await waitFor(() => expect(screen.getByTestId("share-link-manual")).toBeInTheDocument())
    const input = screen.getByTestId("share-link-url-input") as HTMLInputElement
    expect(input.value).toContain("#plan=")
  })

  it("shows an honest 'too large' message, not a broken link, when the current plan won't fit in a shareable URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<PlanReaderPage />)
    // A real, large (100+-node), non-trivial fixture — compresses to ~2.4KB,
    // reliably over the safe-share threshold.
    pasteAndAnalyze(loadFixture("sqlserver", "real-world-large-parallel-estimated.xml"))

    fireEvent.click(screen.getByRole("button", { name: /copy shareable link/i }))

    await waitFor(() => expect(screen.getByTestId("share-link-too-large")).toBeInTheDocument())
    expect(writeText).not.toHaveBeenCalled()
    expect(screen.queryByTestId("share-link-copied")).not.toBeInTheDocument()
  })
})

// Episode 17 — local browser persistence, wired end-to-end into the real page.
describe("PlanReaderPage — local persistence (Episode 17)", () => {
  it("does not show a restore banner or any recent plans on a fresh browser profile", async () => {
    render(<PlanReaderPage />)
    // Let the async loadSession()/listRecentPlans() effects settle.
    await waitFor(() => expect(screen.getByTestId("paste-textarea")).toBeInTheDocument())
    expect(screen.queryByTestId("restore-session-banner")).not.toBeInTheDocument()
    expect(screen.queryByTestId("recent-plans-list")).not.toBeInTheDocument()
    expect(screen.queryByTestId("clear-saved-data-button")).not.toBeInTheDocument()
  })

  it("analyzing a plan saves it, and a later fresh mount offers to restore it", async () => {
    const { unmount } = render(<PlanReaderPage />)
    pasteAndAnalyze(loadFixture("postgres", "simple-seq-scan.json"))
    await waitFor(() => expect(screen.getByTestId("plan-result")).toBeInTheDocument())
    await flushSessionSaveDebounce() // let the real debounced saveSession() call actually land
    unmount()

    render(<PlanReaderPage />)
    await waitFor(() => expect(screen.getByTestId("restore-session-banner")).toBeInTheDocument())
    expect(screen.getByTestId("restore-session-banner")).toHaveTextContent(/restore/i)
  })

  it("clicking Restore re-analyzes the saved plan and dismisses the banner", async () => {
    // Seeds the saved session directly — this test is about the restore
    // UI's own behavior, not about proving the debounced save fires
    // (already covered above).
    await saveSession(loadFixture("postgres", "simple-seq-scan.json"))

    render(<PlanReaderPage />)
    await waitFor(() => expect(screen.getByTestId("restore-session-banner")).toBeInTheDocument())
    fireEvent.click(screen.getByTestId("restore-session-button"))

    expect(screen.getByTestId("plan-result")).toBeInTheDocument()
    expect(screen.queryByTestId("restore-session-banner")).not.toBeInTheDocument()
  })

  it("clicking Dismiss hides the banner without deleting the saved session (still offered on the next visit)", async () => {
    await saveSession(loadFixture("postgres", "simple-seq-scan.json"))

    const { unmount } = render(<PlanReaderPage />)
    await waitFor(() => expect(screen.getByTestId("restore-session-banner")).toBeInTheDocument())
    fireEvent.click(screen.getByTestId("dismiss-restore-button"))
    expect(screen.queryByTestId("restore-session-banner")).not.toBeInTheDocument()
    unmount()

    render(<PlanReaderPage />)
    await waitFor(() => expect(screen.getByTestId("restore-session-banner")).toBeInTheDocument())
  })

  it("never offers to restore a session when a share-link fragment already took priority on this load", async () => {
    const encoded = encodeShareLink(loadFixture("postgres", "simple-seq-scan.json"), "https://example.com/")
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    // Seed an unrelated saved session first...
    const { unmount } = render(<PlanReaderPage />)
    pasteAndAnalyze(loadFixture("postgres", "multi-way-join.json"))
    await waitFor(() => expect(screen.getByTestId("plan-result")).toBeInTheDocument())
    unmount()

    // ...then load with a share-link fragment present.
    window.location.hash = encoded.url.split("#")[1]
    render(<PlanReaderPage />)
    expect(screen.getByTestId("plan-result")).toBeInTheDocument()
    expect(screen.queryByTestId("restore-session-banner")).not.toBeInTheDocument()
    window.location.hash = ""
  })

  it("checking 'don't save' prevents both session persistence and the recent plans list from being written to", async () => {
    const { unmount } = render(<PlanReaderPage />)
    fireEvent.click(screen.getByTestId("dont-save-checkbox"))
    pasteAndAnalyze(loadFixture("postgres", "simple-seq-scan.json"))
    await waitFor(() => expect(screen.getByTestId("plan-result")).toBeInTheDocument())
    unmount()

    render(<PlanReaderPage />)
    await waitFor(() => expect(screen.getByTestId("paste-textarea")).toBeInTheDocument())
    expect(screen.queryByTestId("restore-session-banner")).not.toBeInTheDocument()
    expect(screen.queryByTestId("recent-plans-list")).not.toBeInTheDocument()
  })

  it("adds an analyzed plan to the recent plans list, reachable via its toggle", async () => {
    render(<PlanReaderPage />)
    pasteAndAnalyze(loadFixture("postgres", "simple-seq-scan.json"))
    await waitFor(() => expect(screen.getByTestId("plan-result")).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId("recent-plans-list")).toBeInTheDocument())

    expect(screen.queryByTestId("recent-plan-item")).not.toBeInTheDocument() // collapsed by default
    fireEvent.click(screen.getByTestId("recent-plans-toggle"))
    expect(screen.getByTestId("recent-plan-item")).toBeInTheDocument()
  })

  it("clicking a recent plan entry re-analyzes it", async () => {
    render(<PlanReaderPage />)
    pasteAndAnalyze(loadFixture("postgres", "simple-seq-scan.json"))
    await waitFor(() => expect(screen.getByTestId("recent-plans-list")).toBeInTheDocument())
    pasteAndAnalyze(loadFixture("postgres", "multi-way-join.json"))

    fireEvent.click(screen.getByTestId("recent-plans-toggle"))
    await waitFor(() => expect(screen.getAllByTestId("recent-plan-item")).toHaveLength(2))

    const items = screen.getAllByTestId("recent-plan-item")
    fireEvent.click(items[items.length - 1]) // the oldest listed — simple-seq-scan
    expect(screen.getByTestId("plan-result")).toBeInTheDocument()
  })

  it("deleting one recent plan entry removes only that entry", async () => {
    render(<PlanReaderPage />)
    pasteAndAnalyze(loadFixture("postgres", "simple-seq-scan.json"))
    await waitFor(() => expect(screen.getByTestId("recent-plans-list")).toBeInTheDocument())
    pasteAndAnalyze(loadFixture("postgres", "multi-way-join.json"))

    fireEvent.click(screen.getByTestId("recent-plans-toggle"))
    await waitFor(() => expect(screen.getAllByTestId("recent-plan-item")).toHaveLength(2))

    fireEvent.click(screen.getAllByTestId("recent-plan-delete")[0])
    await waitFor(() => expect(screen.getAllByTestId("recent-plan-item")).toHaveLength(1))
  })

  it("'Clear all' in the recent plans section empties it but does not touch a pending session restore offer", async () => {
    const text = loadFixture("postgres", "simple-seq-scan.json")
    await saveSession(text)
    await addRecentPlan(text, { rootOperatorLabel: "Seq Scan", nodeCount: 1 })

    render(<PlanReaderPage />)
    await waitFor(() => expect(screen.getByTestId("restore-session-banner")).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId("recent-plans-list")).toBeInTheDocument())
    fireEvent.click(screen.getByTestId("recent-plans-toggle"))
    fireEvent.click(screen.getByTestId("recent-plans-clear-all"))

    await waitFor(() => expect(screen.queryByTestId("recent-plans-list")).not.toBeInTheDocument())
    expect(screen.getByTestId("restore-session-banner")).toBeInTheDocument() // untouched
  })

  it("'Clear saved data' wipes both the session and the recent plans list, and the button disappears once nothing is left", async () => {
    render(<PlanReaderPage />)
    pasteAndAnalyze(loadFixture("postgres", "simple-seq-scan.json"))
    await waitFor(() => expect(screen.getByTestId("clear-saved-data-button")).toBeInTheDocument())

    fireEvent.click(screen.getByTestId("clear-saved-data-button"))
    await waitFor(() => expect(screen.queryByTestId("clear-saved-data-button")).not.toBeInTheDocument())
    expect(screen.queryByTestId("recent-plans-list")).not.toBeInTheDocument()
  })

  describe("Episode 14, Story 14.2 — comparison view", () => {
    function pasteAndCompare(text: string) {
      fireEvent.change(screen.getByTestId("compare-paste-textarea"), { target: { value: text } })
      fireEvent.click(screen.getByTestId("compare-paste-submit"))
    }

    it("hides the toggle and shows a second paste box once 'Compare with another plan' is clicked", () => {
      render(<PlanReaderPage />)
      pasteAndAnalyze(loadFixture("postgres", "simple-seq-scan.json"))

      expect(screen.queryByTestId("compare-paste-box")).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId("compare-toggle"))

      expect(screen.getByTestId("compare-paste-box")).toBeInTheDocument()
      expect(screen.queryByTestId("compare-toggle")).not.toBeInTheDocument()
      // The single-plan view is replaced, not just supplemented, while comparing.
      expect(screen.queryByTestId("plan-graph")).not.toBeInTheDocument()
    })

    it("renders the comparison view (summary strip + two panes) once both plans are in", () => {
      render(<PlanReaderPage />)
      pasteAndAnalyze(loadFixture("postgres", "simple-seq-scan.json"))
      fireEvent.click(screen.getByTestId("compare-toggle"))
      pasteAndCompare(loadFixture("postgres", "multi-way-join.json"))

      expect(screen.getByTestId("plan-comparison-view")).toBeInTheDocument()
      expect(screen.getByTestId("comparison-summary")).toBeInTheDocument()
      expect(screen.getByText("Current plan")).toBeInTheDocument()
      expect(screen.getByText("Comparison plan")).toBeInTheDocument()
    })

    it("shows a parse error for an invalid second plan without disturbing the first plan's own view", () => {
      render(<PlanReaderPage />)
      pasteAndAnalyze(loadFixture("postgres", "simple-seq-scan.json"))
      fireEvent.click(screen.getByTestId("compare-toggle"))
      pasteAndCompare(loadFixture("postgres", "non-plan-text.txt"))

      expect(screen.getByTestId("compare-parse-error")).toBeInTheDocument()
      expect(screen.queryByTestId("plan-comparison-view")).not.toBeInTheDocument()
      // Still offered the (still-empty) second paste box, not knocked back
      // to the toggle button.
      expect(screen.getByTestId("compare-paste-box")).toBeInTheDocument()
    })

    it("shows the cross-engine message, not a broken view, when the two plans are from different engines", () => {
      render(<PlanReaderPage />)
      pasteAndAnalyze(loadFixture("postgres", "simple-seq-scan.json"))
      fireEvent.click(screen.getByTestId("compare-toggle"))
      pasteAndCompare(loadFixture("sqlserver", "hash-join.xml"))

      expect(screen.getByTestId("plan-comparison-error")).toHaveTextContent(/different database engines/)
    })

    it("'Stop comparing' returns to the single-plan view with the primary plan intact", () => {
      render(<PlanReaderPage />)
      pasteAndAnalyze(loadFixture("postgres", "simple-seq-scan.json"))
      fireEvent.click(screen.getByTestId("compare-toggle"))
      pasteAndCompare(loadFixture("postgres", "multi-way-join.json"))
      expect(screen.getByTestId("plan-comparison-view")).toBeInTheDocument()

      fireEvent.click(screen.getByTestId("stop-comparing"))

      expect(screen.queryByTestId("plan-comparison-view")).not.toBeInTheDocument()
      expect(screen.getByTestId("plan-graph")).toBeInTheDocument()
      expect(screen.getByTestId("compare-toggle")).toBeInTheDocument()
    })

    it("'Cancel' on the second paste box returns to the single-plan view without requiring a second plan", () => {
      render(<PlanReaderPage />)
      pasteAndAnalyze(loadFixture("postgres", "simple-seq-scan.json"))
      fireEvent.click(screen.getByTestId("compare-toggle"))
      expect(screen.getByTestId("compare-paste-box")).toBeInTheDocument()

      fireEvent.click(screen.getByTestId("compare-cancel"))

      expect(screen.queryByTestId("compare-paste-box")).not.toBeInTheDocument()
      expect(screen.getByTestId("plan-graph")).toBeInTheDocument()
    })
  })
})
