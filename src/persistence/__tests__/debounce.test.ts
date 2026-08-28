import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { debounce } from "../debounce"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("debounce", () => {
  it("only calls the underlying function once after the wait, for a burst of calls", () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 300)

    debounced("a")
    debounced("b")
    debounced("c")
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith("c") // the LAST call's arguments win
  })

  it("calls again after a fresh burst once the wait has elapsed", () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced("first")
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)

    debounced("second")
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith("second")
  })
})
