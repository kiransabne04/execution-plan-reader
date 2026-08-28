import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PlanReaderPage } from "../PlanReaderPage"
import { encodeShareLink } from "../shareLink"

function loadFixture(engine: string, filename: string): string {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../fixtures/${engine}`)
  return readFileSync(path.join(dir, filename), "utf-8")
}

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
