import { type BundledLanguage, codeToHtml, codeToTokens } from "shiki"

const THEME = "github-dark"

/**
 * Highlight a code block to themed HTML. Shiki loads only the requested grammar
 * and theme on demand (the bundler code-splits them), so this stays cheap.
 * Falls back to plain `text` highlighting, then to `null` so callers can render
 * an unstyled `<pre>` instead.
 */
export async function highlightCode(
  code: string,
  lang: string | undefined
): Promise<string | null> {
  const language = lang?.toLowerCase() || "text"

  try {
    return await codeToHtml(code, { lang: language, theme: THEME })
  } catch {
    try {
      return await codeToHtml(code, { lang: "text", theme: THEME })
    } catch {
      return null
    }
  }
}

/** One syntax-highlighted span: text plus its themed color/style. */
export interface HlToken {
  content: string
  color?: string
  italic?: boolean
}

/** A code block tokenized into per-line spans, with the theme's surface colors —
 *  used to render diffs/code with our own gutter and line decorations. */
export interface Highlighted {
  lines: HlToken[][]
  bg: string
  fg: string
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
  tokens: { content: string; color?: string; fontStyle?: number }[][]
  bg?: string
  fg?: string
}): Highlighted {
  return {
    lines: result.tokens.map((line) =>
      line.map((t) => ({
        content: t.content,
        color: t.color,
        // fontStyle is a bitmask; bit 1 is italic.
        italic: ((t.fontStyle ?? 0) & 1) !== 0,
      }))
    ),
    bg: result.bg ?? "#24292e",
    fg: result.fg ?? "#e1e4e8",
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
      await codeToTokens(code, { lang: (lang || "text") as BundledLanguage, theme: THEME })
    )
  } catch {
    try {
      return toHighlighted(await codeToTokens(code, { lang: "text", theme: THEME }))
    } catch {
      return null
    }
  }
}
