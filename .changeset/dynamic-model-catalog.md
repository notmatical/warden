---
"@warden/desktop": patch
---

Dynamic model catalog: the model list, fast-tier variants, and per-role defaults now refresh at runtime from the published models.json (main branch) with a localStorage cache and the bundled copy as offline fallback — new or retired models reach every install without a release. The catalog schema is versioned (v1) and gains per-model `fastId`, `recommended`, `deprecated`, and `hidden` flags. See docs/MODEL-CATALOG.md.
