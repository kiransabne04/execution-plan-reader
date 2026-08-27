import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { render, screen, fireEvent } from "@testing-library/react"
import { PlanReaderPage } from "../PlanReaderPage"

function loadFixture(engine: string, filename: string): string {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../fixtures/${engine}`)
  return readFileSync(path.join(dir, filename), "utf-8")
}

function pasteAndAnalyze(text: string) {
  fireEvent.change(screen.getByTestId("paste-textarea"), { target: { value: text } })
  fireEvent.click(screen.getByRole("button", { name: /analyze plan/i }))
}

describe("PlanReaderPage", () => {
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
    expect(screen.getByText("Postgres")).toBeInTheDocument()
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

  it("disables the analyze button until something is pasted", () => {
    render(<PlanReaderPage />)
    expect(screen.getByRole("button", { name: /analyze plan/i })).toBeDisabled()
    fireEvent.change(screen.getByTestId("paste-textarea"), { target: { value: "x" } })
    expect(screen.getByRole("button", { name: /analyze plan/i })).not.toBeDisabled()
  })
})
