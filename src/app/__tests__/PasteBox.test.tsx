// Episode 18, Story 18.5 — file drop, file picker, and sample-plan loaders.
// jsdom does implement File/FileReader/DataTransfer well enough to exercise
// these paths directly (unlike, say, CSS container queries) — no need to
// defer this story's own testing approach items to e2e-only, though the
// e2e suite (e2e/plan-input.spec.ts) still covers the real-browser
// file-chooser API and the zero-network-calls guarantee specifically.

import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PasteBox } from "../PasteBox"
import { SAMPLE_PLANS } from "../samplePlans"

function renderPasteBox(onAnalyze = vi.fn()) {
  render(
    <PasteBox
      onAnalyze={onAnalyze}
      dontSave={false}
      onDontSaveChange={() => {}}
      hasSavedData={false}
      onClearSavedData={() => {}}
    />,
  )
  return { onAnalyze }
}

describe("PasteBox — Story 18.5", () => {
  it("renders one sample-plan button per engine, and clicking one analyzes that real fixture's text directly", () => {
    const { onAnalyze } = renderPasteBox()
    expect(SAMPLE_PLANS).toHaveLength(3)
    for (const sample of SAMPLE_PLANS) {
      expect(screen.getByTestId(`sample-plan-${sample.engine}`)).toBeInTheDocument()
    }

    fireEvent.click(screen.getByTestId("sample-plan-postgres"))
    expect(onAnalyze).toHaveBeenCalledWith(SAMPLE_PLANS[0].text)
    // The textarea also reflects it — same treatment a recovered share
    // link already gets, not a silent behind-the-scenes analyze.
    expect(screen.getByTestId("paste-textarea")).toHaveValue(SAMPLE_PLANS[0].text)
  })

  it("picking a file via the file input reads it with FileReader and analyzes its text — no fetch/XHR involved", async () => {
    const { onAnalyze } = renderPasteBox()
    const file = new File(["Seq Scan on users  (cost=0.00..1.00 rows=1 width=8)"], "plan.txt", { type: "text/plain" })

    fireEvent.change(screen.getByTestId("file-picker-input"), { target: { files: [file] } })

    await waitFor(() => expect(onAnalyze).toHaveBeenCalledWith("Seq Scan on users  (cost=0.00..1.00 rows=1 width=8)"))
    expect(screen.getByTestId("paste-textarea")).toHaveValue("Seq Scan on users  (cost=0.00..1.00 rows=1 width=8)")
  })

  it("dropping a file onto the textarea (the dropzone) reads and analyzes it the same way the file picker does", async () => {
    const { onAnalyze } = renderPasteBox()
    const file = new File(["dropped plan content"], "dropped.txt", { type: "text/plain" })
    const dataTransfer = { files: [file] }

    fireEvent.dragOver(screen.getByTestId("paste-textarea"), { dataTransfer })
    fireEvent.drop(screen.getByTestId("paste-textarea"), { dataTransfer })

    await waitFor(() => expect(onAnalyze).toHaveBeenCalledWith("dropped plan content"))
  })

  it("picking the same file twice in a row still re-analyzes it (the input's own value is reset after each pick)", async () => {
    const { onAnalyze } = renderPasteBox()
    const file = new File(["same content"], "plan.txt", { type: "text/plain" })
    const input = screen.getByTestId("file-picker-input") as HTMLInputElement

    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(onAnalyze).toHaveBeenCalledTimes(1))
    expect(input.value).toBe("")

    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(onAnalyze).toHaveBeenCalledTimes(2))
  })

  it("a binary/garbage file still reaches onAnalyze — the SAME error path a bad paste already goes through handles it, not a second one", async () => {
    // PasteBox's own job is only to hand text to onAnalyze; whether that
    // text is a valid plan is handleAnalyze's concern (see
    // PlanReaderPage.tsx), already covered by the paste-driven parse-error
    // tests in PlanReaderPage.test.tsx. This just confirms a file with
    // garbage/binary-ish content still reaches that same single path.
    const { onAnalyze } = renderPasteBox()
    const garbage = new File([new Uint8Array([0x00, 0xff, 0x10, 0x02])], "binary.dat")
    fireEvent.change(screen.getByTestId("file-picker-input"), { target: { files: [garbage] } })
    await waitFor(() => expect(onAnalyze).toHaveBeenCalledTimes(1))
  })

  it("hero-adjacent controls stay present: privacy statement, don't-save checkbox, and Analyze button are all still there", () => {
    renderPasteBox()
    expect(screen.getByTestId("privacy-statement")).toBeInTheDocument()
    expect(screen.getByTestId("dont-save-checkbox")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /analyze plan/i })).toBeInTheDocument()
  })
})
