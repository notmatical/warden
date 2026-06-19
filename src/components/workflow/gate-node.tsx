import { Handle, type NodeProps, Position, useReactFlow } from "@xyflow/react"
import { Check, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { GATE_META } from "@/lib/workflow-intents"
import { useAppStore } from "@/store/app-store"

/** A gate carries no config — its name is fixed. The data slot only tags the
 *  owning workflow so run status can't bleed in from another workflow's run. */
export interface GateNodeData {
  workflowId?: string
  [key: string]: unknown
}

/** Canonical name. Don't make it editable — there's nothing to disambiguate
 *  between gates, they all do the same thing. */
const GATE_LABEL = "User Approval"

const HANDLE_CLASS =
  "!size-2.5 !rounded-full !border-2 !border-card !bg-muted-foreground transition-colors hover:!bg-primary"

export function GateNode({ id, data, selected }: NodeProps) {
  const node = data as GateNodeData
  const { deleteElements } = useReactFlow()
  const status = useAppStore((s) =>
    s.workflowRun?.run.workflowId === node.workflowId
      ? s.workflowRun.nodes.find((n) => n.nodeId === id)?.status
      : undefined
  )
  const resumeRun = useAppStore((s) => s.resumeRun)
  const paused = status === "paused"
  const GateIcon = GATE_META.icon

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
            <div className="flex items-center gap-2.5 border-b border-border/60 bg-muted/30 px-2.5 py-2">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/12">
                <GateIcon className="size-4 text-amber-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-foreground">
                  {GATE_LABEL}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {paused ? "Awaiting your approval" : "Pauses for approval"}
                </div>
              </div>
            </div>

            {paused ? (
              <div className="nodrag flex gap-1.5 px-2.5 py-2">
                <Button
                  size="xs"
                  onClick={() => void resumeRun(true)}
                  className="flex-1 gap-1 bg-emerald-600 text-white hover:bg-emerald-600/90"
                >
                  <Check className="size-3" />
                  Approve
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void resumeRun(false)}
                  className="flex-1 gap-1 text-red-500 hover:bg-red-500/10 hover:text-red-500"
                >
                  <X className="size-3" />
                  Reject
                </Button>
              </div>
            ) : null}
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
