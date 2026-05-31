import { codeToHtml } from "shiki"

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
  const theme = "github-dark"

  try {
    return await codeToHtml(code, { lang: language, theme })
  } catch {
    try {
      return await codeToHtml(code, { lang: "text", theme })
    } catch {
      return null
    }
  }
}
