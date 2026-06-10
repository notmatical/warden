import { type CodeViewItem, parseDiffFromFile } from "@pierre/diffs"
import { CodeView } from "@pierre/diffs/react"
import {
  FileTree as PierreFileTree,
  useFileTree,
} from "@pierre/trees/react"
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronDown,
  ChevronRight,
  FileDiff,
  FolderTree,
  Loader2,
  RefreshCw,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { FileTypeIcon } from "@/components/ui/file-type-icon"
import {
  type SegmentedTabItem,
  SegmentedTabs,
} from "@/components/ui/segmented-tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useCodeViewOptions } from "@/hooks/use-code-view-options"
import { hashVersion } from "@/lib/hash"
import * as ipc from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { diffSessionIdOf } from "@/lib/viewport"
import { useAppStore } from "@/store/app-store"
import type { FileEntry } from "@/types"
import type { DiffFile } from "@/types/git-diff"

type Tab = "files" | "browse"

/** The Zed-style stacked diff: every changed file as a collapsible section with
 *  a sticky header (name, +N/−N) over its rendered diff. */
function FilesView({
  sessionId,
  files,
  loading,
}: {
  sessionId: string
  files: DiffFile[]
  loading: boolean
}) {
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

  const textFiles = useMemo(() => files.filter((f) => !f.binary), [files])
  const binaryCount = files.length - textFiles.length

  // One contents fetch per file, keyed by its stat line so it refetches when
  // the file's diff changes but stays cached across collapses/re-renders.
  const versionQueries = useQueries({
    queries: textFiles.map((f) => ({
      queryKey: [
        "session-diff-file",
        sessionId,
        f.path,
        f.added,
        f.removed,
      ] as const,
      queryFn: () => ipc.getSessionFileVersions(sessionId, f.path),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  })

  // useQueries returns a fresh array each render; this scalar captures the
  // actual data inputs so the memo below recomputes only on real changes.
  const versionsKey = versionQueries.map((q) => q.dataUpdatedAt).join(",")

  // biome-ignore lint/correctness/useExhaustiveDependencies: versionsKey stands in for versionQueries (see above)
  const items = useMemo(() => {
    const out: CodeViewItem<undefined>[] = []
    for (let i = 0; i < textFiles.length; i++) {
      const file = textFiles[i]
      const data = versionQueries[i]?.data
      if (!data) continue
      const fileDiff = parseDiffFromFile(
        { name: file.path, contents: data.oldText ?? "" },
        { name: file.path, contents: data.newText ?? "" }
      )
      // `collapsed` feeds the version hash on purpose: the version bump is
      // what makes CodeView re-render the item in its new state (superset
      // does exactly this).
      const isCollapsed = collapsed.has(file.path)
      out.push({
        id: file.path,
        type: "diff",
        fileDiff,
        collapsed: isCollapsed,
        version: hashVersion(
          [
            file.path,
            file.added,
            file.removed,
            versionQueries[i]?.dataUpdatedAt ?? 0,
            isCollapsed ? "1" : "0",
          ].join("\0")
        ),
      })
    }
    return out
  }, [textFiles, collapsed, versionsKey])

  const options = useCodeViewOptions()

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

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          "No changes since the session started."
        )}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {textFiles.length === 0 ? (
          <span className="text-sm">
            Only binary files changed ({binaryCount}).
          </span>
        ) : (
          <Loader2 className="size-4 animate-spin" />
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-col">
      <CodeView<undefined>
        className="h-full w-full overflow-y-auto overflow-x-clip overscroll-contain px-2 [overflow-anchor:none]"
        style={{ "--diffs-font-size": "12px" } as React.CSSProperties}
        items={items}
        options={options}
        renderHeaderPrefix={renderHeaderPrefix}
      />
      {binaryCount > 0 ? (
        <div className="border-t border-border/60 px-4 py-1.5 text-[11px] text-muted-foreground">
          {binaryCount} binary file{binaryCount === 1 ? "" : "s"} changed (not
          shown)
        </div>
      ) : null}
    </div>
  )
}

// ----- browse: file tree + read-only viewer ---------------------------------

/** Map pierre's tree theming onto warden's tokens (superset's pattern). */
const TREE_STYLE = {
  "--trees-row-height-override": "24px",
  "--trees-padding-inline-override": "4px",
  "--trees-item-row-gap-override": "6px",
  "--trees-border-radius-override": "4px",
  "--trees-bg-override": "var(--background)",
  "--trees-fg-override": "var(--foreground)",
  "--trees-fg-muted-override": "var(--muted-foreground)",
  "--trees-bg-muted-override":
    "color-mix(in oklab, var(--accent) 50%, transparent)",
  "--trees-accent-override": "var(--accent)",
  "--trees-border-color-override": "var(--border)",
  "--trees-selected-bg-override": "var(--accent)",
  "--trees-selected-fg-override": "var(--accent-foreground)",
  "--trees-selected-focused-border-color-override": "var(--ring)",
  "--trees-focus-ring-color-override": "var(--ring)",
  "--trees-focus-ring-offset-override": "0px",
  "--trees-font-size-override": "12px",
} as React.CSSProperties

/** Read-only contents of one worktree file, highlighted by the same CodeView
 *  pipeline as the diffs. */
function FileViewer({ sessionId, path }: { sessionId: string; path: string }) {
  const options = useCodeViewOptions("file")
  const query = useQuery({
    queryKey: ["session-file", sessionId, path],
    queryFn: () => ipc.getSessionFileVersions(sessionId, path),
    staleTime: 30_000,
  })

  if (query.isPending) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }
  const contents = query.data?.newText
  if (contents == null) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Can't display this file — it's binary or no longer on disk.
      </div>
    )
  }
  const items: CodeViewItem<undefined>[] = [
    {
      id: path,
      type: "file",
      file: { name: path, contents },
      version: hashVersion(`${path}\0${query.dataUpdatedAt}`),
    },
  ]
  return (
    <CodeView<undefined>
      className="h-full w-full overflow-y-auto overflow-x-clip overscroll-contain [overflow-anchor:none]"
      style={
        {
          "--diffs-font-size": "12px",
          // Belt and braces with the :host rule — inherited into the shadow
          // tree, so the theme canvas never paints over the pane.
          "--diffs-light-bg": "transparent",
          "--diffs-dark-bg": "transparent",
        } as React.CSSProperties
      }
      items={items}
      options={options}
    />
  )
}

/** Explorer for the session's working tree: pierre's virtualized file tree
 *  (colored per-language icons, sticky folders) on the left, read-only viewer
 *  on the right — superset's explorer, themed to warden. */
function BrowseView({ sessionId }: { sessionId: string }) {
  const workingDir = useAppStore((s) => s.sessions[sessionId]?.workingDir)
  const [selected, setSelected] = useState<string | null>(null)

  const filesQuery = useQuery({
    queryKey: ["session-browse", sessionId, workingDir],
    queryFn: () => ipc.listFiles(workingDir ?? "", 5000),
    enabled: !!workingDir,
    staleTime: 30_000,
  })

  const { model } = useFileTree({
    paths: [],
    initialExpansion: "closed",
    search: false,
    icons: { set: "complete", colored: true },
    itemHeight: 24,
    overscan: 20,
    stickyFolders: true,
    onSelectionChange: (paths) => {
      const last = paths[paths.length - 1]
      if (!last || last.endsWith("/")) return
      setSelected(last)
    },
  })

  // The model is created once; feed it (and re-feed on refetch) imperatively.
  useEffect(() => {
    if (filesQuery.data) {
      model.resetPaths(filesQuery.data.map((f) => f.path))
    }
  }, [filesQuery.data, model])

  if (filesQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)]">
      <PierreFileTree
        model={model}
        className="min-h-0 border-r border-border/60"
        style={TREE_STYLE}
      />
      {selected ? (
        <FileViewer sessionId={sessionId} path={selected} />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Select a file to read it.
        </div>
      )}
    </div>
  )
}

/** The session's changes since base, as a real tab: stacked collapsible
 *  per-file diffs (the main view) plus a browser for the whole working tree. */
export function SessionDiffPane({ refId }: { refId: string }) {
  const sessionId = diffSessionIdOf(refId)
  const session = useAppStore((s) => s.sessions[sessionId])
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>("files")

  const filesQuery = useQuery({
    queryKey: ["session-diff", sessionId],
    queryFn: () => ipc.getSessionDiff(sessionId),
    refetchOnWindowFocus: true,
  })

  // Refresh whenever a turn finishes — that's when the diff actually moves.
  const running = session?.status === "running"
  useEffect(() => {
    if (running) return
    void queryClient.invalidateQueries({
      queryKey: ["session-diff", sessionId],
    })
  }, [running, sessionId, queryClient])

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: ["session-diff", sessionId],
    })
    void queryClient.invalidateQueries({
      queryKey: ["session-diff-file", sessionId],
    })
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        This session no longer exists.
      </div>
    )
  }

  const files = filesQuery.data ?? []
  const added = files.reduce((sum, f) => sum + f.added, 0)
  const removed = files.reduce((sum, f) => sum + f.removed, 0)

  const tabs: SegmentedTabItem<Tab>[] = [
    { id: "files", label: `Changes (${files.length})`, icon: FileDiff },
    { id: "browse", label: "Browse", icon: FolderTree },
  ]

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <SegmentedTabs
        tabs={tabs}
        value={tab}
        onChange={setTab}
        className="px-2 py-1.5"
      >
        <span className="text-[11px] tabular-nums text-muted-foreground">
          <span className="text-positive">+{added}</span>{" "}
          <span className="text-destructive">−{removed}</span>
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Refresh diff"
              onClick={refresh}
              className="text-muted-foreground hover:text-foreground"
            >
              <RefreshCw
                className={cn(
                  "size-3.5",
                  filesQuery.isFetching && "animate-spin"
                )}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
      </SegmentedTabs>

      {tab === "files" ? (
        <FilesView
          sessionId={sessionId}
          files={files}
          loading={filesQuery.isPending}
        />
      ) : (
        <BrowseView sessionId={sessionId} />
      )}
    </div>
  )
}
