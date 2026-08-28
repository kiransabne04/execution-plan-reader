import "@testing-library/jest-dom/vitest"
// jsdom has no IndexedDB implementation at all (`typeof indexedDB ===
// "undefined"`) — Episode 17's local persistence layer (src/persistence/)
// needs a real one to test against, not a hand-rolled mock that could
// silently diverge from actual IndexedDB semantics (transaction atomicity,
// quota errors, versioning). fake-indexeddb is a widely-used, spec-
// faithful in-memory implementation, dev-dependency only.
import "fake-indexeddb/auto"

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
