import type { CodeViewOptions } from "@pierre/diffs"
import { useMemo } from "react"

import { useTheme } from "@/components/theme-provider"
import diffCardsCss from "@/styles/pierre-diff-cards.css?raw"
import fileFlushCss from "@/styles/pierre-file-flush.css?raw"

export function useResolvedTheme(): "dark" | "light" {
  const { theme } = useTheme()
  if (theme !== "system") return theme
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

/** Shared CodeView config for the Changes accordion ("diff": each file a
 *  rounded card) and the Browse file viewer ("file": flush, transparent).
 *  The shadow-DOM styling lives in src/styles/pierre-*.css. */
export function useCodeViewOptions(
  variant: "diff" | "file" = "diff"
): CodeViewOptions<undefined> {
  const themeType = useResolvedTheme()
  return useMemo<CodeViewOptions<undefined>>(
    () => ({
      diffStyle: "unified",
      overflow: "wrap",
      // A transparent (file-variant) sticky header would smear over scrolled
      // code; the single file's header reads fine pinned at the top.
      stickyHeaders: variant === "diff",
      theme: { dark: "vitesse-dark", light: "vitesse-light" },
      themeType,
      layout:
        variant === "diff"
          ? { paddingTop: 8, paddingBottom: 16, gap: 10 }
          : { paddingTop: 0, paddingBottom: 0, gap: 0 },
      // Degrade gracefully on lockfiles / minified bundles instead of
      // blocking the highlighter worker.
      tokenizeMaxLineLength: 5_000,
      tokenizeMaxLength: 200_000,
      maxLineDiffLength: 5_000,
      unsafeCSS: variant === "diff" ? diffCardsCss : fileFlushCss,
    }),
    [themeType, variant]
  )
}
