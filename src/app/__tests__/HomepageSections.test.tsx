// Episode SEO-02, Story 02.2 — the homepage content sections below the
// analyzer shell.

import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { HomepageSections } from "../HomepageSections"
import {
  FAQ_ITEMS,
  HOW_IT_WORKS,
  SAMPLE_PLANS_ANCHOR_ID,
  SUPPORTED_DATABASES,
  WHAT_IT_DETECTS,
  WHY_PLANREADER,
} from "../homepageContent"

describe("HomepageSections — Story 02.2", () => {
  it("renders every required section as a real, findable heading, in the story's own order", () => {
    render(<HomepageSections />)
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual([
      "Supported Databases",
      "What PlanReader Detects",
      "Why PlanReader",
      "How It Works",
      "Privacy",
      "Try an Example",
      "Learn More",
      "FAQ",
    ])
  })

  it("never renders an <h1> — the app's only <h1> stays the empty-state heading (PlanReaderPage.tsx)", () => {
    render(<HomepageSections />)
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0)
  })

  it("names all three supported engines with their real accepted input format", () => {
    render(<HomepageSections />)
    for (const db of SUPPORTED_DATABASES) {
      expect(screen.getByText(db.engine)).toBeInTheDocument()
      expect(screen.getByText(db.format)).toBeInTheDocument()
    }
  })

  it("links each engine to its dedicated landing page", () => {
    render(<HomepageSections />)
    for (const db of SUPPORTED_DATABASES) {
      expect(screen.getByRole("link", { name: db.engine })).toHaveAttribute("href", db.href)
    }
  })

  it("lists every 'what it detects' and 'why PlanReader' bullet", () => {
    render(<HomepageSections />)
    for (const item of [...WHAT_IT_DETECTS, ...WHY_PLANREADER]) {
      expect(screen.getByText(item)).toBeInTheDocument()
    }
  })

  it("renders all 3 How It Works steps, numbered in order", () => {
    render(<HomepageSections />)
    const steps = screen.getAllByRole("listitem").filter((li) => li.querySelector(".homepage-section__step-number"))
    expect(steps).toHaveLength(HOW_IT_WORKS.length)
    steps.forEach((step, index) => {
      expect(step).toHaveTextContent(String(index + 1))
      expect(step).toHaveTextContent(HOW_IT_WORKS[index].title)
    })
  })

  it("renders every FAQ question and answer as a real dt/dd pair, not fabricated FAQPage schema", () => {
    render(<HomepageSections />)
    for (const item of FAQ_ITEMS) {
      expect(screen.getByText(item.question)).toBeInTheDocument()
      expect(screen.getByText(item.answer)).toBeInTheDocument()
    }
  })

  it("the Try an Example CTA scrolls to the real sample-plan buttons rather than duplicating them", () => {
    // The button's target lives in PasteBox, not here — this test only
    // proves the CTA calls scrollIntoView on the right element id; a real
    // scroll-and-see-it happens in e2e/positioning.spec.ts against the
    // full page.
    const target = document.createElement("div")
    target.id = SAMPLE_PLANS_ANCHOR_ID
    let scrolledInto = false
    target.scrollIntoView = () => {
      scrolledInto = true
    }
    document.body.appendChild(target)

    render(<HomepageSections />)
    screen.getByTestId("try-an-example-cta").click()
    expect(scrolledInto).toBe(true)

    document.body.removeChild(target)
  })
})
