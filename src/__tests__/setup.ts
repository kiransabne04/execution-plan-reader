import "@testing-library/jest-dom/vitest"

// jsdom doesn't implement ResizeObserver, but React Flow (src/graph/) needs
// one to measure its container/nodes. A minimal no-op stub is enough for
// component tests, which only assert on DOM structure, not real layout.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
