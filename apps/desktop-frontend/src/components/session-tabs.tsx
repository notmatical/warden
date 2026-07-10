import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Pencil, X } from "lucide-react"
import { type KeyboardEvent, useState } from "react"
import { SessionFavicon } from "@/components/session-favicon"
import { Badge } from "@/components/ui/badge"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { describe } from "@/lib/viewport/content-registry"
import { useAppStore } from "@/store/app-store"

/* Browser-style tab chrome: the active tab is background-colored and "merges"
   into the inset content card below via two concave corner fillers, like
   Chrome. Inactive tabs are quiet text with a hover pill. */

const tabOuter = (active: boolean, dragging: boolean) =>
  cn(
    "group relative flex h-full min-w-32 shrink-0 cursor-pointer select-none items-center py-1 text-[13px]",
    // The active tab grows to fit its title (never cut off); inactive tabs
    // stay capped and truncate, like a browser's tab strip.
    active
      ? "max-w-80 rounded-t-xl bg-background text-foreground [box-shadow:-1px_-1px_1px_0.1px_#0000001A,1px_-1px_1px_0.1px_#0000001A]"
      : "max-w-48 text-muted-foreground",
    // The floating clone stands in while dragging; the hidden original keeps
    // its slot so neighbors slide around a real gap.
    dragging && "opacity-0"
  )

const tabInner = (active: boolean) =>
  cn(
    "flex h-full w-full min-w-0 items-center gap-2 rounded-md px-2.5 transition-colors",
    !active && "group-hover:bg-foreground/5 group-hover:text-foreground"
  )

// Matches the neighbors' slide to the strong ease-out used app-wide.
const SORT_TRANSITION = {
  duration: 170,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
}

/** Sortable wiring shared by session and static tabs: sliding transform while
 *  a drag is in progress, and the original hidden under the floating clone. */
function useTabSortable(tabId: string) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: tabId,
    data: { type: "tab", sessionId: tabId },
    transition: SORT_TRANSITION,
  })
  return {
    setNodeRef,
    attributes,
    listeners,
    isDragging,
    style: { transform: CSS.Translate.toString(transform), transition },
  }
}

/** Concave corner filler that blends the active tab's base into the content
 *  card below it (the Chrome/Safari tab silhouette). */
function TabCorner({ side }: { side: "left" | "right" }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute bottom-0",
        side === "left"
          ? "-left-2.5 [filter:drop-shadow(-1.2px_-0.5px_1px_#0000001A)]"
          : "-right-2.5 [filter:drop-shadow(1.2px_-0.5px_1px_#0000001A)]"
      )}
    >
      <path
        d={
          side === "left"
            ? "M10 10H0C5.523 10 10 5.523 10 0V10Z"
            : "M0 10L0 0C0 5.523 4.477 10 10 10L0 10Z"
        }
        fill="var(--background)"
      />
    </svg>
  )
}

/** Hairline divider on a tab's trailing edge. Pure CSS visibility: hidden when
 *  its own tab or either neighbor is hovered/active, and during any tab drag
 *  (the strip sets `data-tab-dragging`). Living inside the tab, it slides with
 *  it during reorder. */
function TabDivider() {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute top-1/2 -right-px h-4 w-px -translate-y-1/2 bg-foreground/5 transition-opacity",
        "group-hover:opacity-0 group-aria-selected:opacity-0",
        "[[role=tab]:has(+[role=tab]:hover)>&]:opacity-0",
        "[[role=tab]:has(+[aria-selected=true])>&]:opacity-0",
        "[[data-tab-dragging]_&]:opacity-0"
      )}
    />
  )
}

function CloseButton({
  label,
  onClose,
}: {
  label: string
  onClose: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
      className="-mr-0.5 ml-auto flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition group-hover:opacity-100 group-aria-selected:opacity-100 hover:bg-foreground/10 hover:text-foreground"
    >
      <X className="size-3.5" />
    </button>
  )
}

function Tab({ sessionId, divider }: { sessionId: string; divider: boolean }) {
  // Narrow primitive selectors — re-render only when the rendered fields change.
  const title = useAppStore((s) => s.sessions[sessionId]?.title)
  const status = useAppStore((s) => s.sessions[sessionId]?.status)
  const role = useAppStore((s) => s.sessions[sessionId]?.role)
  const backend = useAppStore((s) => s.sessions[sessionId]?.backend)
  const kind = useAppStore((s) => s.sessions[sessionId]?.kind)
  const terminalCommand = useAppStore(
    (s) => s.sessions[sessionId]?.terminalCommand
  )
  const active = useAppStore((s) => s.activeTabId === sessionId)
  const hasOthers = useAppStore((s) => s.openTabs.length > 1)
  // With a global tab strip, tabs from different workspaces sit side by side;
  // label the workspace (only when more than one exists).
  const workspace = useAppStore((s) => {
    if (s.groups.length < 2) return undefined
    const groupId = s.sessions[sessionId]?.groupId
    return groupId ? s.groups.find((g) => g.id === groupId)?.name : undefined
  })
  const selectTab = useAppStore((s) => s.selectTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const closeOthers = useAppStore((s) => s.closeOthers)
  const renameSession = useAppStore((s) => s.renameSession)

  const { setNodeRef, attributes, listeners, isDragging, style } =
    useTabSortable(sessionId)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")

  if (title === undefined || status === undefined) {
    return null
  }

  const tabIcon = (
    <SessionFavicon
      kind={kind}
      backend={backend}
      status={status}
      terminalCommand={terminalCommand}
      className="size-[18px]"
    />
  )

  const startRename = () => {
    setDraft(title)
    setEditing(true)
  }

  const commitRename = () => {
    setEditing(false)
    void renameSession(sessionId, draft)
  }

  const onEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === "Enter") {
      event.preventDefault()
      commitRename()
    } else if (event.key === "Escape") {
      event.preventDefault()
      setEditing(false)
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          role="tab"
          aria-selected={active}
          tabIndex={0}
          onClick={() => selectTab(sessionId)}
          onDoubleClick={startRename}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              selectTab(sessionId)
            }
          }}
          className={tabOuter(active, isDragging)}
        >
          {active ? <TabCorner side="left" /> : null}
          <div className={tabInner(active)}>
            {tabIcon}
            <span className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
              {editing ? (
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onEditKeyDown}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 rounded-md bg-background px-1 text-[13px] ring-1 ring-border outline-none"
                />
              ) : (
                <span className="truncate text-[13px]" title={title}>
                  {title}
                </span>
              )}
              {workspace ? (
                <span
                  className="truncate text-[10px] text-muted-foreground/55"
                  title={workspace}
                >
                  {workspace}
                </span>
              ) : null}
            </span>
            {role !== "chat" ? (
              <Badge variant="secondary" className="capitalize">
                {role === "planner" ? "plan" : "code"}
              </Badge>
            ) : null}
            <CloseButton
              label="Close tab"
              onClose={() => closeTab(sessionId)}
            />
          </div>
          {active ? <TabCorner side="right" /> : null}
          {divider ? <TabDivider /> : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => startRename()}>
          <Pencil />
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => closeTab(sessionId)}>
          <X />
          Close
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!hasOthers}
          onSelect={() => closeOthers(sessionId)}
        >
          Close others
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** A non-session tab (workflow, settings, tasks, issues) — label + icon come
 *  from the content registry, no status/role, same drag/drop + close + context
 *  menu as a regular tab. */
function StaticTab({ tabId, divider }: { tabId: string; divider: boolean }) {
  const d = describe(tabId)
  const Icon = d.icon
  const label = useAppStore((s) => d.title(s, tabId)) ?? ""
  const active = useAppStore((s) => s.activeTabId === tabId)
  const hasOthers = useAppStore((s) => s.openTabs.length > 1)
  const selectTab = useAppStore((s) => s.selectTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const closeOthers = useAppStore((s) => s.closeOthers)

  const { setNodeRef, attributes, listeners, isDragging, style } =
    useTabSortable(tabId)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          role="tab"
          aria-selected={active}
          tabIndex={0}
          onClick={() => selectTab(tabId)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              selectTab(tabId)
            }
          }}
          className={tabOuter(active, isDragging)}
        >
          {active ? <TabCorner side="left" /> : null}
          <div className={tabInner(active)}>
            <Icon className="size-[18px] shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[13px]" title={label}>
              {label}
            </span>
            <CloseButton label="Close tab" onClose={() => closeTab(tabId)} />
          </div>
          {active ? <TabCorner side="right" /> : null}
          {divider ? <TabDivider /> : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => closeTab(tabId)}>
          <X />
          Close
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!hasOthers}
          onSelect={() => closeOthers(tabId)}
        >
          Close others
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** The titlebar tab strip. Scrolls horizontally (hidden scrollbar, wheel maps
 *  to horizontal) and pads both ends so the active tab's corner fillers never
 *  clip; the trailing spacer doubles as the window drag region. Tabs reorder
 *  live — neighbors slide while a tab is dragged. */
export function SessionTabs() {
  const order = useAppStore((s) => s.openTabs)
  const dragging = useAppStore((s) => s.draggingSessionId !== null)

  return (
    <div className="flex h-full min-w-0 flex-1 items-stretch">
      {order.length > 0 ? (
        <div
          data-tab-dragging={dragging ? "" : undefined}
          className="no-scrollbar flex h-full items-stretch overflow-x-auto pr-3 pl-6"
          onWheel={(e) => {
            if (e.deltaY !== 0 && e.deltaX === 0) {
              e.currentTarget.scrollLeft += e.deltaY
            }
          }}
        >
          <SortableContext
            items={order}
            strategy={horizontalListSortingStrategy}
          >
            {order.map((id, i) =>
              describe(id).kind === "session" ? (
                <Tab key={id} sessionId={id} divider={i < order.length - 1} />
              ) : (
                <StaticTab key={id} tabId={id} divider={i < order.length - 1} />
              )
            )}
          </SortableContext>
        </div>
      ) : null}
      <div data-tauri-drag-region className="h-full min-w-8 flex-1" />
    </div>
  )
}
