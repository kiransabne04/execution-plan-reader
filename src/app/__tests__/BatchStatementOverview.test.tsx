import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { BatchStatementOverview } from "../BatchStatementOverview"
import type { BatchHealth } from "../batchHealth"

const health: BatchHealth = {
  worstScore: 40,
  medianScore: 88,
  criticalStatementCount: 1,
  topStatements: [
    { index: 3, label: "slow-statement", durationMs: 900, criticalFindingCount: 1, rank: 1 },
    { index: 1, label: "medium-statement", durationMs: 500, criticalFindingCount: 0, rank: 2 },
  ],
}

describe("BatchStatementOverview", () => {
  it("renders nothing when there are no ranked statements", () => {
    const { container } = render(<BatchStatementOverview health={{ worstScore: undefined, medianScore: undefined, criticalStatementCount: 0, topStatements: [] }} onSelectStatement={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders worst/median/critical-count and each top statement", () => {
    render(<BatchStatementOverview health={health} onSelectStatement={vi.fn()} />)
    expect(screen.getByTestId("batch-statement-overview")).toBeInTheDocument()
    expect(screen.getByText("40")).toBeInTheDocument()
    expect(screen.getByText("88")).toBeInTheDocument()
    expect(screen.getByText("slow-statement")).toBeInTheDocument()
    expect(screen.getByText("medium-statement")).toBeInTheDocument()
    expect(screen.getByText(/900\.0ms/)).toBeInTheDocument()
  })

  it("calls onSelectStatement with the statement's original batch index when clicked", () => {
    const onSelect = vi.fn()
    render(<BatchStatementOverview health={health} onSelectStatement={onSelect} />)
    fireEvent.click(screen.getByText("slow-statement"))
    expect(onSelect).toHaveBeenCalledWith(3)
  })

  it("shows an em dash for worst/median when the batch has no scoreable statement", () => {
    render(<BatchStatementOverview health={{ ...health, worstScore: undefined, medianScore: undefined }} onSelectStatement={vi.fn()} />)
    expect(screen.getAllByText("—").length).toBeGreaterThan(0)
  })

  it("falls back to displaying cost when a top statement has no real duration", () => {
    render(
      <BatchStatementOverview
        health={{ ...health, topStatements: [{ index: 0, label: "cost-only", estimatedCost: 42, criticalFindingCount: 0, rank: 1 }] }}
        onSelectStatement={vi.fn()}
      />,
    )
    expect(screen.getByText(/cost 42/)).toBeInTheDocument()
  })
})
