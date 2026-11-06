import { beforeEach, describe, expect, it, vi } from "vitest"
import { dismissCallout, isCalloutDismissed } from "../calloutDismissal"

describe("calloutDismissal", () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it("starts undismissed", () => {
    expect(isCalloutDismissed("walstack-postgres")).toBe(false)
  })

  it("persists a dismissal for that product", () => {
    dismissCallout("walstack-postgres")
    expect(isCalloutDismissed("walstack-postgres")).toBe(true)
  })

  it("scopes dismissal per product — dismissing PostgreSQL doesn't dismiss Snowflake", () => {
    dismissCallout("walstack-postgres")
    expect(isCalloutDismissed("walstack-snowflake")).toBe(false)
  })

  // Story 9.1's ad-blocker/privacy-extension edge case: sessionStorage
  // access can throw in some browsers/extensions. Must degrade to "always
  // show" (never crash, never silently become "always hidden").
  it("degrades to 'not dismissed' rather than throwing when sessionStorage.getItem throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(() => isCalloutDismissed("walstack-postgres")).not.toThrow()
    expect(isCalloutDismissed("walstack-postgres")).toBe(false)
    spy.mockRestore()
  })

  it("never throws when sessionStorage.setItem throws", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(() => dismissCallout("walstack-postgres")).not.toThrow()
    spy.mockRestore()
  })
})
