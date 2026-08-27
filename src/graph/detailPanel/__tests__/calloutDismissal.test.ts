import { beforeEach, describe, expect, it, vi } from "vitest"
import { dismissCallout, isCalloutDismissed } from "../calloutDismissal"

describe("calloutDismissal", () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it("starts undismissed", () => {
    expect(isCalloutDismissed("pgsuite")).toBe(false)
  })

  it("persists a dismissal for that product", () => {
    dismissCallout("pgsuite")
    expect(isCalloutDismissed("pgsuite")).toBe(true)
  })

  it("scopes dismissal per product — dismissing pgsuite doesn't dismiss querydoc", () => {
    dismissCallout("pgsuite")
    expect(isCalloutDismissed("querydoc")).toBe(false)
  })

  // Story 9.1's ad-blocker/privacy-extension edge case: sessionStorage
  // access can throw in some browsers/extensions. Must degrade to "always
  // show" (never crash, never silently become "always hidden").
  it("degrades to 'not dismissed' rather than throwing when sessionStorage.getItem throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(() => isCalloutDismissed("pgsuite")).not.toThrow()
    expect(isCalloutDismissed("pgsuite")).toBe(false)
    spy.mockRestore()
  })

  it("never throws when sessionStorage.setItem throws", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(() => dismissCallout("pgsuite")).not.toThrow()
    spy.mockRestore()
  })
})
