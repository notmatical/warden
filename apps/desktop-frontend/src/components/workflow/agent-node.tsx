import { Handle, type NodeProps, Position, useReactFlow } from "@xyflow/react"
import { AlertTriangle, ChevronDown, ExternalLink, Trash2 } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"

import { BrailleSpinner } from "@/components/ui/braille-spinner"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { INTENT_META } from "@/lib/workflow-intents"
import { useAppStore } from "@/store/app-store"
import type { AgentTaskConfig, WorkflowNodeRun } from "@/types/workflow"

import { AgentConfig } from "./agent-config"
import { STATUS_PILL } from "./status"

export interface AgentNodeData {
  label: string
  config: AgentTaskConfig
  /** Owning workflow — run status only applies when the live run is its run. */
  workflowId?: string
  [key: string]: unknown
}

const HANDLE_CLASS =
  "!size-2.5 !rounded-full !border-2 !border-card !bg-muted-foreground transition-colors hover:!bg-primary"

/** Height the card settles to before you expand it. Tuned to show the top of
 *  the config and fade into the rest. */
const COLLAPSED_MAX = 220

export function AgentNode({ id, data, selected }: NodeProps) {
  const node = data as AgentNodeData
  const { updateNodeData, deleteElements } = useReactFlow()
  const nodeRun = useAppStore((s) =>
    s.workflowRun?.run.workflowId === node.workflowId
      ? s.workflowRun?.nodes.find((n) => n.nodeId === id)
      : undefined
  )
  const openSession = useAppStore((s) => s.openSession)
  const status = nodeRun?.status
  const cfg = node.config
  const meta = INTENT_META[cfg.intent]
  const Icon = meta.icon

  const patchConfig = (patch: Partial<AgentTaskConfig>) =>
    updateNodeData(id, { config: { ...cfg, ...patch } })

  const hasRunInfo = nodeRun != null && nodeRun.status !== "pending"

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/* Outer layer is the handles' positioning context so the pins are
            never clipped; the inner card clips the body to the corners. */}
        <div className="relative w-80">
          <Handle
            type="target"
            position={Position.Left}
            className={HANDLE_CLASS}
          />
          <div
            className={cn(
              "overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm transition",
              selected && "ring-2 ring-primary/70"
            )}
          >
            {/* Neutral header; the node's type reads from its icon alone. */}
            <div className="flex items-center gap-2.5 border-border/60 border-b bg-muted/30 px-2.5 py-2">
              <div
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg",
                  meta.tile
                )}
              >
                <Icon className={cn("size-4", meta.accent)} />
              </div>
              <span className="min-w-0 flex-1 truncate font-medium text-[13px] text-foreground">
                {node.label || meta.label}
              </span>
              {status === "running" ? (
                <BrailleSpinner className="shrink-0" />
              ) : status === "awaitingInput" ? (
                <AlertTriangle
                  className="size-3.5 shrink-0 text-amber-500"
                  aria-label="Waiting for your answer"
                />
              ) : status && status !== "pending" ? (
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    STATUS_PILL[status].dot
                  )}
                />
              ) : null}
            </div>

            {/* Config is always visible (Unreal-blueprint style); the card caps
                its height and fades into a chevron when there's more below. The
                body itself stays draggable (so the whole card is a drag target);
                only the interactive controls carry `nodrag`. nowheel scrolls the
                body, and stopping key/double-click keeps canvas shortcuts from
                firing while editing. */}
            <Expandable maxHeight={COLLAPSED_MAX}>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: these handlers only stop canvas shortcuts from firing while editing, not real interactions */}
              <div
                className="nowheel space-y-2.5 p-2.5"
                onKeyDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <div className="space-y-1">
                  <span className="font-medium text-[11px] text-muted-foreground">
                    Label
                  </span>
                  <Input
                    value={node.label}
                    onChange={(e) =>
                      updateNodeData(id, { label: e.target.value })
                    }
                    className="nodrag h-7 text-[13px]"
                  />
                </div>
                <AgentConfig config={cfg} patchConfig={patchConfig} />
                {hasRunInfo && nodeRun ? (
                  <NodeOutput nodeRun={nodeRun} openSession={openSession} />
                ) : null}
              </div>
            </Expandable>
          </div>
          <Handle
            type="source"
            position={Position.Right}
            className={HANDLE_CLASS}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        <ContextMenuItem
          variant="destructive"
          onSelect={() => void deleteElements({ nodes: [{ id }] })}
        >
          <Trash2 className="size-3.5" />
          Delete node
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Caps its content's height with a gradient fade and a ghost chevron that
 *  expands to the full height. The chevron only appears when the content
 *  actually overflows (measured live, so it tracks config/output changes). */
function Expandable({
  children,
  maxHeight,
}: {
  children: ReactNode
  maxHeight: number
}) {
  // Open by default; collapse caps the height with a fade + chevron.
  const [expanded, setExpanded] = useState(true)
  const [overflowing, setOverflowing] = useState(false)
  const innerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    const measure = () => setOverflowing(el.scrollHeight > maxHeight + 2)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [maxHeight])

  return (
    <div
      className={cn(
        "relative overflow-hidden",
        expanded && overflowing && "pb-7"
      )}
      style={{ maxHeight: expanded ? undefined : maxHeight }}
    >
      <div ref={innerRef}>{children}</div>
      {!expanded && overflowing ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" />
      ) : null}
      {/* Ghost chevron floating over the fade — only when there's more to show. */}
      {overflowing ? (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? "Collapse node" : "Expand node"}
          className="nodrag -translate-x-1/2 absolute bottom-1 left-1/2 flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <ChevronDown
            className={cn(
              "size-4 transition-transform",
              expanded && "rotate-180"
            )}
          />
        </button>
      ) : null}
    </div>
  )
}

/** A node's run result, inline under its config: an error or the output, plus a
 *  jump to the full session (also reachable by double-clicking the node). The
 *  running state itself reads from the header spinner, so there's no badge. */
function NodeOutput({
  nodeRun,
  openSession,
}: {
  nodeRun: WorkflowNodeRun
  openSession: (id: string) => void
}) {
  const sessionId = nodeRun.sessionId
  const output = nodeRun.output?.trim()
  // Mid-run with nothing to show yet: the header spinner already says it all.
  if (!nodeRun.error && !output && !sessionId) return null
  return (
    <div className="space-y-1.5 border-border/60 border-t pt-2.5">
      {nodeRun.error ? (
        <Callout variant="destructive" size="sm">
          {nodeRun.error}
        </Callout>
      ) : output ? (
        <div className="nodrag max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground">
          {output}
        </div>
      ) : null}
      {sessionId ? (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => openSession(sessionId)}
          className="nodrag h-6 gap-1.5 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3" />
          Open session
        </Button>
      ) : null}
    </div>
  )
}
