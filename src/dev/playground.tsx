import { type CodeViewItem, parseDiffFromFile } from "@pierre/diffs"
import { CodeView, WorkerPoolContextProvider } from "@pierre/diffs/react"
import PierreDiffsWorker from "@pierre/diffs/worker/worker.js?worker"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"

import "@/styles/globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { FileTypeIcon } from "@/components/ui/file-type-icon"
import { useCodeViewOptions } from "@/hooks/use-code-view-options"
import { hashVersion } from "@/lib/hash"

/** Dev playground mirroring the Changes accordion (session-diff-pane) with
 *  fake data, so layout/styling can be inspected in a plain browser via
 *  `bun run dev:web` → /playground.html. */

const OLD_A = `fn main() {
    let a = 1;
    let b = 2;
    println!("{}", a + b);
}
`
const NEW_A = `fn main() {
    let a = 1;
    let b = 3;
    let c = 4;
    println!("{}", a + b + c);
}
`

const OLD_B = Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n")
const NEW_B = Array.from({ length: 120 }, (_, i) =>
  i === 40
    ? "line forty — changed"
    : i === 90
      ? "line ninety — changed"
      : `line ${i}`
).join("\n")

const FILES = [
  { path: "src/main.rs", oldText: OLD_A, newText: NEW_A },
  { path: "docs/BUILD-PERFORMANCE.md", oldText: OLD_B, newText: NEW_B },
]

function Accordion() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  )
  const toggleCollapsed = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const items = useMemo(() => {
    const out: CodeViewItem<undefined>[] = []
    for (const file of FILES) {
      const isCollapsed = collapsed.has(file.path)
      out.push({
        id: file.path,
        type: "diff",
        fileDiff: parseDiffFromFile(
          { name: file.path, contents: file.oldText },
          { name: file.path, contents: file.newText }
        ),
        collapsed: isCollapsed,
        version: hashVersion(`${file.path}\0${isCollapsed ? "1" : "0"}`),
      })
    }
    return out
  }, [collapsed])

  const options = useCodeViewOptions("diff")

  const renderHeaderPrefix = useCallback(
    (item: CodeViewItem<undefined>) => (
      <span className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => toggleCollapsed(item.id)}
          aria-label={collapsed.has(item.id) ? "Expand file" : "Collapse file"}
          className="rounded p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
        >
          {collapsed.has(item.id) ? (
            <ChevronRight className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </button>
        <FileTypeIcon path={item.id} className="size-3.5" />
      </span>
    ),
    [collapsed, toggleCollapsed]
  )

  return (
    <CodeView<undefined>
      className="h-full w-full overflow-y-auto overflow-x-clip overscroll-contain px-3 [overflow-anchor:none]"
      style={{ "--diffs-font-size": "12px" } as React.CSSProperties}
      items={items}
      options={options}
      renderHeaderPrefix={renderHeaderPrefix}
    />
  )
}

const TREE_PATHS = [
  "src/main.rs",
  "src/lib/util.ts",
  "src/components/button.tsx",
  "src/components/dialog.tsx",
  "src/styles/globals.css",
  "docs/BUILD-PERFORMANCE.md",
  "package.json",
  "README.md",
  "Cargo.toml",
]

function Tree() {
  const { model } = useFileTree({
    paths: [],
    initialExpansion: "open",
    search: false,
    icons: { set: "complete", colored: true },
    itemHeight: 24,
    overscan: 20,
    stickyFolders: true,
  })
  useEffect(() => {
    model.resetPaths(TREE_PATHS)
  }, [model])
  return (
    <FileTree model={model} className="min-h-0 border-r border-border/60" />
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <WorkerPoolContextProvider
        poolOptions={{
          workerFactory: () => new PierreDiffsWorker(),
          poolSize: 2,
        }}
        highlighterOptions={{ preferredHighlighter: "shiki-wasm" }}
      >
        {/* Fixed height, not h-svh: hidden/headless windows report a zero
            viewport, which would collapse the scrollport and break the
            virtualizer. */}
        <div className="grid h-[800px] grid-rows-[auto_minmax(0,1fr)] bg-background text-foreground">
          <p className="px-3 py-2 text-xs text-muted-foreground">
            diff accordion playground — toggle the chevrons and watch the header
            geometry
          </p>
          <div className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)]">
            <Tree />
            <Accordion />
          </div>
        </div>
      </WorkerPoolContextProvider>
    </ThemeProvider>
  </StrictMode>
)
