import {
  type CodeViewItem,
  type CodeViewOptions,
  parseDiffFromFile,
} from "@pierre/diffs"
import { CodeView } from "@pierre/diffs/react"
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileDiff,
  FolderOpen as FolderOpenIcon,
  Folder as FolderIcon,
  FolderTree,
  GitCommit as GitCommitIcon,
  Loader2,
  RefreshCw,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import * as ipc from "@/lib/ipc"
import { relativeTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { diffSessionIdOf } from "@/lib/viewport"
import { useAppStore } from "@/store/app-store"
import type { FileEntry } from "@/types"
import type { DiffFile } from "@/types/git-diff"

type Tab = "files" | "commits" | "browse"

/** Cheap content-version hash (FNV-1a) so CodeView re-renders an item only
 *  when its diff data or collapsed state actually changed. */
function hashVersion(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function useResolvedTheme(): "dark" | "light" {
  const { theme } = useTheme()
  if (theme !== "system") return theme
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

/** Shared CodeView config for the diff accordion and the file viewer, so both
 *  render with identical themes, wrapping, and large-file degradation. The
 *  diff variant draws each file as a padded card; the file variant sits flush
 *  against the pane on the app background. */
function useCodeViewOptions(
  variant: "diff" | "file" = "diff"
): CodeViewOptions<undefined> {
  const themeType = useResolvedTheme()
  return useMemo<CodeViewOptions<undefined>>(
    () => ({
      diffStyle: "unified",
      overflow: "wrap",
      stickyHeaders: true,
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
      unsafeCSS:
        variant === "diff"
          ? `
        * { user-select: text; -webkit-user-select: text; }
        /* The chevron in the prefix slot replaces Pierre's status badge. */
        [data-diffs-header='default'] [data-change-icon] { display: none; }
        [data-diffs-header='default'] [data-additions-count] { color: var(--positive, #3fb950); }
        [data-diffs-header='default'] [data-deletions-count] { color: var(--destructive, #f85149); }
        /* Shiki's theme bg is set inline on <pre>; pin it to the app surface. */
        [data-diff] {
          --diffs-light-bg: var(--card) !important;
          --diffs-dark-bg: var(--card) !important;
        }
      `
          : `
        * { user-select: text; -webkit-user-select: text; }
        /* Blend into the pane: app background, no card inset. */
        [data-diff], [data-file] {
          --diffs-light-bg: var(--background) !important;
          --diffs-dark-bg: var(--background) !important;
        }
      `,
    }),
    [themeType, variant]
  )
}

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
        className="h-full w-full overflow-y-auto overflow-x-clip overscroll-contain px-3 [overflow-anchor:none]"
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

interface DirNode {
  name: string
  path: string
  dirs: DirNode[]
  files: { name: string; path: string }[]
}

/** Fold the walker's flat `a/b/c.ts` list into a sorted directory tree. */
function buildTree(entries: FileEntry[]): DirNode {
  const root: DirNode = { name: "", path: "", dirs: [], files: [] }
  const index = new Map<string, DirNode>([["", root]])
  const ensureDir = (path: string): DirNode => {
    const existing = index.get(path)
    if (existing) return existing
    const cut = path.lastIndexOf("/")
    const parent = ensureDir(cut === -1 ? "" : path.slice(0, cut))
    const node: DirNode = {
      name: cut === -1 ? path : path.slice(cut + 1),
      path,
      dirs: [],
      files: [],
    }
    parent.dirs.push(node)
    index.set(path, node)
    return node
  }
  for (const entry of entries) {
    const cut = entry.path.lastIndexOf("/")
    const dir = ensureDir(cut === -1 ? "" : entry.path.slice(0, cut))
    dir.files.push({ name: entry.name, path: entry.path })
  }
  const sortNode = (node: DirNode) => {
    node.dirs.sort((a, b) => a.name.localeCompare(b.name))
    node.files.sort((a, b) => a.name.localeCompare(b.name))
    node.dirs.forEach(sortNode)
  }
  sortNode(root)
  return root
}

function TreeLevel({
  node,
  depth,
  expanded,
  onToggle,
  selected,
  onSelect,
}: {
  node: DirNode
  depth: number
  expanded: ReadonlySet<string>
  onToggle: (path: string) => void
  selected: string | null
  onSelect: (path: string) => void
}) {
  const indent = { paddingLeft: `${depth * 12 + 8}px` }
  return (
    <>
      {node.dirs.map((dir) => {
        const open = expanded.has(dir.path)
        return (
          <div key={dir.path}>
            <button
              type="button"
              onClick={() => onToggle(dir.path)}
              style={indent}
              className="flex h-6 w-full items-center gap-1.5 pr-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              {open ? (
                <ChevronDown className="size-3 shrink-0" />
              ) : (
                <ChevronRight className="size-3 shrink-0" />
              )}
              {open ? (
                <FolderOpenIcon className="size-3.5 shrink-0 opacity-70" />
              ) : (
                <FolderIcon className="size-3.5 shrink-0 opacity-70" />
              )}
              <span className="truncate">{dir.name}</span>
            </button>
            {open ? (
              <TreeLevel
                node={dir}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                selected={selected}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        )
      })}
      {node.files.map((file) => (
        <button
          key={file.path}
          type="button"
          onClick={() => onSelect(file.path)}
          style={{ paddingLeft: `${depth * 12 + 8 + 16}px` }}
          className={cn(
            "flex h-6 w-full items-center gap-1.5 pr-2 text-left text-xs transition-colors",
            selected === file.path
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          )}
          title={file.path}
        >
          <FileCode2 className="size-3.5 shrink-0 opacity-60" />
          <span className="truncate">{file.name}</span>
        </button>
      ))}
    </>
  )
}

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
      style={{ "--diffs-font-size": "12px" } as React.CSSProperties}
      items={items}
      options={options}
    />
  )
}

/** Explorer for the session's working tree: gitignore-aware file tree on the
 *  left, read-only viewer on the right. */
function BrowseView({ sessionId }: { sessionId: string }) {
  const workingDir = useAppStore((s) => s.sessions[sessionId]?.workingDir)
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  )
  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const filesQuery = useQuery({
    queryKey: ["session-browse", sessionId, workingDir],
    queryFn: () => ipc.listFiles(workingDir ?? "", 5000),
    enabled: !!workingDir,
    staleTime: 30_000,
  })
  const tree = useMemo(
    () => buildTree(filesQuery.data ?? []),
    [filesQuery.data]
  )

  if (filesQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)]">
      <div className="min-h-0 overflow-y-auto border-r border-border/60 py-1">
        <TreeLevel
          node={tree}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          selected={selected}
          onSelect={setSelected}
        />
      </div>
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
 *  per-file diffs (the main view) plus the branch's commit list. */
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
  const commitsQuery = useQuery({
    queryKey: ["session-commits", sessionId],
    queryFn: () => ipc.getSessionCommits(sessionId),
    refetchOnWindowFocus: true,
  })

  // Refresh whenever a turn finishes — that's when the diff actually moves.
  const running = session?.status === "running"
  useEffect(() => {
    if (running) return
    void queryClient.invalidateQueries({ queryKey: ["session-diff", sessionId] })
    void queryClient.invalidateQueries({
      queryKey: ["session-commits", sessionId],
    })
  }, [running, sessionId, queryClient])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["session-diff", sessionId] })
    void queryClient.invalidateQueries({
      queryKey: ["session-diff-file", sessionId],
    })
    void queryClient.invalidateQueries({
      queryKey: ["session-commits", sessionId],
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
  const commits = commitsQuery.data ?? []
  const added = files.reduce((sum, f) => sum + f.added, 0)
  const removed = files.reduce((sum, f) => sum + f.removed, 0)

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="flex items-center gap-1 px-2 py-1.5">
        {(
          [
            {
              id: "files",
              label: `Changes (${files.length})`,
              Icon: FileDiff,
            },
            {
              id: "commits",
              label: `Commits (${commits.length})`,
              Icon: GitCommitIcon,
            },
            { id: "browse", label: "Browse", Icon: FolderTree },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              tab === id
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
        <span className="ml-2 text-[11px] tabular-nums text-muted-foreground">
          <span className="text-positive">+{added}</span>{" "}
          <span className="text-destructive">−{removed}</span>
        </span>
        <div className="ml-auto">
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
        </div>
      </div>

      {tab === "files" ? (
        <FilesView
          sessionId={sessionId}
          files={files}
          loading={filesQuery.isPending}
        />
      ) : tab === "browse" ? (
        <BrowseView sessionId={sessionId} />
      ) : commits.length === 0 ? (
        <div className="flex items-center justify-center text-sm text-muted-foreground">
          No commits yet.
        </div>
      ) : (
        <div className="divide-y divide-border/50 overflow-y-auto">
          {commits.map((c) => (
            <div key={c.sha} className="flex items-baseline gap-3 px-4 py-2.5">
              <code className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {c.sha.slice(0, 7)}
              </code>
              <span className="min-w-0 flex-1 truncate text-sm">
                {c.subject}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {c.author} · {relativeTime(c.date)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
