import { describe, expect, it } from "bun:test"

import { baseModelId, isFastModel, supportsFast, withFast } from "./models"

// These assert against the bundled catalog (models.json): `claude-opus-4-8[1m]`
// has a fast variant; Grok/Cursor default ids genuinely end in `-fast` and are
// not in the catalog, so they must not be mistaken for warden fast variants.
describe("fast-tier semantics", () => {
  it("recognizes a catalog fast variant", () => {
    expect(isFastModel("claude-opus-4-8[1m]-fast")).toBe(true)
    expect(baseModelId("claude-opus-4-8[1m]-fast")).toBe("claude-opus-4-8[1m]")
    expect(supportsFast("claude-opus-4-8[1m]")).toBe(true)
  })

  it("leaves native ids ending in -fast untouched", () => {
    for (const id of [
      "grok/grok-composer-2.5-fast",
      "cursor/composer-2.5-fast",
    ]) {
      expect(isFastModel(id)).toBe(false)
      expect(baseModelId(id)).toBe(id)
      expect(supportsFast(id)).toBe(false)
    }
  })

  it("withFast resolves the catalog variant and is reversible", () => {
    expect(withFast("claude-opus-4-8[1m]", true)).toBe("claude-opus-4-8[1m]-fast")
    expect(withFast("claude-opus-4-8[1m]-fast", false)).toBe("claude-opus-4-8[1m]")
    // A native -fast id has no variant, so toggling fast is a no-op.
    expect(withFast("grok/grok-composer-2.5-fast", true)).toBe(
      "grok/grok-composer-2.5-fast"
    )
  })
})
