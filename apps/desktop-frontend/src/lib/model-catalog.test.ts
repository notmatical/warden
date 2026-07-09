import { describe, expect, it } from "bun:test"

import { BUNDLED_CATALOG, parseCatalog } from "./model-catalog"

const validDefaults = {
  chat: "claude-opus-4-8",
  planner: "claude-sonnet-4-6",
  coder: "claude-opus-4-8",
  codexChat: "gpt-5.5",
  opencodeChat: "opencode/big-pickle",
  cursorChat: "cursor/auto",
  grokChat: "grok/grok-composer-2.5-fast",
}

const model = { id: "claude-opus-4-8", label: "Opus 4.8", provider: "Anthropic" }

describe("parseCatalog", () => {
  it("accepts a minimal valid catalog", () => {
    const catalog = parseCatalog({
      version: 1,
      models: [model],
      defaults: validDefaults,
    })
    expect(catalog).not.toBeNull()
    expect(catalog?.models).toHaveLength(1)
  })

  it("rejects unknown versions (breaking changes gate on it)", () => {
    expect(
      parseCatalog({ version: 2, models: [model], defaults: validDefaults })
    ).toBeNull()
    expect(parseCatalog({ models: [model], defaults: validDefaults })).toBeNull()
  })

  it("drops malformed model entries without rejecting the catalog", () => {
    const catalog = parseCatalog({
      version: 1,
      models: [model, { id: "x" }, { id: 3, label: "y", provider: "z" }, null],
      defaults: validDefaults,
    })
    expect(catalog?.models.map((m) => m.id)).toEqual(["claude-opus-4-8"])
  })

  it("rejects a catalog with no usable models or missing defaults", () => {
    expect(
      parseCatalog({ version: 1, models: [{}], defaults: validDefaults })
    ).toBeNull()
    expect(
      parseCatalog({
        version: 1,
        models: [model],
        defaults: { ...validDefaults, chat: "" },
      })
    ).toBeNull()
  })

  it("keeps only well-typed optional flags", () => {
    const catalog = parseCatalog({
      version: 1,
      models: [
        {
          ...model,
          fastId: "claude-opus-4-8-fast",
          hidden: "yes", // wrong type — dropped, not coerced
          deprecated: true,
          extraUnknownField: 123,
        },
      ],
      defaults: validDefaults,
    })
    const entry = catalog?.models[0]
    expect(entry?.fastId).toBe("claude-opus-4-8-fast")
    expect(entry?.hidden).toBeUndefined()
    expect(entry?.deprecated).toBe(true)
  })

  it("ignores unknown top-level fields (additive schema changes are safe)", () => {
    const catalog = parseCatalog({
      version: 1,
      updatedAt: "2026-07-08",
      futureField: { anything: true },
      models: [model],
      defaults: validDefaults,
    })
    expect(catalog?.updatedAt).toBe("2026-07-08")
  })
})

describe("bundled catalog", () => {
  it("passes its own validation (the build-time safety net)", () => {
    expect(BUNDLED_CATALOG.version).toBe(1)
    expect(BUNDLED_CATALOG.models.length).toBeGreaterThan(0)
    expect(BUNDLED_CATALOG.defaults.chat.length).toBeGreaterThan(0)
  })

  it("fast variants reference real catalog conventions", () => {
    for (const m of BUNDLED_CATALOG.models) {
      if (m.fastId) expect(m.fastId).toBe(`${m.id}-fast`)
    }
  })
})
