import { Handle, type NodeProps, Position, useReactFlow } from "@xyflow/react"
import { AlertTriangle, Loader2, Trash2 } from "lucide-react"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { baseModelId, MODELS } from "@/lib/models"
import { PROVIDER_ICON } from "@/lib/provider-icons"
import { cn } from "@/lib/utils"
import { INTENT_META } from "@/lib/workflow-intents"
import { useAppStore } from "@/store/app-store"
import type { Backend } from "@/types"
import type { AgentTaskConfig, NodeRunStatus } from "@/types/workflow"

export interface AgentNodeData {
  label: string
  config: AgentTaskConfig
  [key: string]: unknown
}

function backendOf(model: string): Backend {
  const id = model.toLowerCase()
  return id.startsWith("gpt") || id.startsWith("codex") ? "codex" : "claude"
}

const STATUS_DOT: Record<NodeRunStatus, string> = {
  pending: "bg-muted-foreground/30",
  running: "bg-blue-500",
  done: "bg-emerald-500",
  failed: "bg-red-500",
  skipped: "bg-muted-foreground/30",
  paused: "bg-amber-500",
  awaitingInput: "bg-amber-500",
}

const HANDLE_CLASS =
  "!size-2.5 !rounded-full !border-2 !border-card !bg-muted-foreground transition-colors hover:!bg-primary"

export function AgentNode({ id, data, selected }: NodeProps) {
  const node = data as AgentNodeData
  const { deleteElements } = useReactFlow()
  const status = useAppStore(
    (s) => s.workflowRun?.nodes.find((n) => n.nodeId === id)?.status
  )
  const cfg = node.config
  const meta = INTENT_META[cfg.intent]
  const Icon = meta.icon
  const ProviderIcon = PROVIDER_ICON[backendOf(cfg.model)]
  const model =
    MODELS.find((m) => m.id === baseModelId(cfg.model))?.label ?? cfg.model

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/* Outer layer is the handles' positioning context so the pins are
            never clipped; the inner card clips the header to the corners. */}
        <div className="relative w-60">
          <Handle
            type="target"
            position={Position.Top}
            className={HANDLE_CLASS}
          />
          <div
            className={cn(
              "overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm transition",
              selected && "ring-2 ring-primary/70"
            )}
          >
            {/* Neutral header; the node's type reads from its icon alone. */}
            <div className="flex items-center gap-2.5 border-b border-border/60 bg-muted/30 px-2.5 py-2">
              <div
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg",
                  meta.tile
                )}
              >
                <Icon className={cn("size-4", meta.accent)} />
              </div>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                {node.label || meta.label}
              </span>
              {status === "running" ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-blue-500" />
              ) : status === "awaitingInput" ? (
                <AlertTriangle
                  className="size-3.5 shrink-0 text-amber-500"
                  aria-label="Waiting for your answer"
                />
              ) : status && status !== "pending" ? (
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    STATUS_DOT[status]
                  )}
                />
              ) : null}
            </div>

            {/* Body: where the task actually runs. */}
            <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-muted-foreground">
              <ProviderIcon className="size-3 shrink-0" />
              <span className="truncate">{model}</span>
            </div>
          </div>
          <Handle
            type="source"
            position={Position.Bottom}
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
