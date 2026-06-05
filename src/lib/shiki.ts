import { type BundledLanguage, codeToHtml, codeToTokens } from "shiki"

// Warm, low-saturation light+dark pair so highlighted code reads as part of the
// UI in either mode. Colors come back as `--shiki-light`/`--shiki-dark` CSS
// variables (see `defaultColor: false`), resolved per-theme in globals.css — so
// the surface can use the app's own tokens instead of a baked-in code color.
const THEMES = { light: "vitesse-light", dark: "vitesse-dark" } as const

/**
 * Highlight a code block to themed HTML. Shiki loads only the requested grammar
 * and themes on demand (the bundler code-splits them), so this stays cheap.
 * Falls back to plain `text` highlighting, then to `null` so callers can render
 * an unstyled `<pre>` instead.
 */
export async function highlightCode(
  code: string,
  lang: string | undefined
): Promise<string | null> {
  const language = lang?.toLowerCase() || "text"

  try {
    return await codeToHtml(code, { lang: language, themes: THEMES, defaultColor: false })
  } catch {
    try {
      return await codeToHtml(code, { lang: "text", themes: THEMES, defaultColor: false })
    } catch {
      return null
    }
  }
}

/** One syntax-highlighted span: text plus its per-theme color CSS variables
 *  (`--shiki-light`/`--shiki-dark`), resolved to `color` by theme in CSS. */
export interface HlToken {
  content: string
  style?: Record<string, string>
}

/** A code block tokenized into per-line spans — used to render diffs/code with
 *  our own gutter and line decorations on the app's surface. */
export interface Highlighted {
  lines: HlToken[][]
}

const EXT_LANG: Record<string, string> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js",
  rs: "rust", py: "python", rb: "ruby", go: "go", java: "java", kt: "kotlin",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp",
  json: "json", jsonc: "json", json5: "json", md: "markdown", mdx: "mdx",
  css: "css", scss: "scss", less: "less", html: "html", xml: "xml", svg: "xml",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash", ps1: "powershell",
  toml: "toml", yaml: "yaml", yml: "yaml", sql: "sql", graphql: "graphql",
  php: "php", swift: "swift", scala: "scala", lua: "lua", dart: "dart", r: "r",
  vue: "vue", svelte: "svelte", astro: "astro", proto: "proto",
}

/** Best-effort shiki language id for a file path, by extension/filename. */
export function langFromPath(path: string | undefined): string {
  if (!path) return "text"
  const base = path.split(/[/\\]/).pop()?.toLowerCase() ?? ""
  if (base === "dockerfile") return "docker"
  if (base.startsWith("makefile")) return "makefile"
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : ""
  return EXT_LANG[ext] ?? "text"
}

function toHighlighted(result: {
  tokens: { content: string; htmlStyle?: Record<string, string> }[][]
}): Highlighted {
  return {
    lines: result.tokens.map((line) =>
      line.map((t) => ({ content: t.content, style: t.htmlStyle }))
    ),
  }
}

/** Tokenize code for our own renderer. Falls back to plaintext, then `null`. */
export async function highlightTokens(
  code: string,
  lang: string
): Promise<Highlighted | null> {
  try {
    // Shiki types `lang` as a union of bundled ids; ours is a runtime string —
    // a miss just throws and falls through to the plaintext path below.
    return toHighlighted(
      await codeToTokens(code, {
        lang: (lang || "text") as BundledLanguage,
        themes: THEMES,
        defaultColor: false,
      })
    )
  } catch {
    try {
      return toHighlighted(
        await codeToTokens(code, { lang: "text", themes: THEMES, defaultColor: false })
      )
    } catch {
      return null
    }
  }
}
