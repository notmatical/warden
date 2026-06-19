import "@xyflow/react/dist/style.css"
import "@/styles/workflow.css"

import {
  addEdge,
  Background,
  type Connection,
  Controls,
  type Edge,
  type Node,
  type OnConnectEnd,
  type OnConnectStart,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react"
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"

import { useConfirm } from "@/components/confirm-dialog"
import { EffortMenu } from "@/components/controls/effort-menu"
import { ModeMenu } from "@/components/controls/mode-menu"
import { ModelMenu } from "@/components/controls/model-menu"
import { Transcript } from "@/components/transcript"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { listWorkflowRuns } from "@/lib/ipc"
import { backendForModel } from "@/lib/models"
import { relativeTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { createsCycle } from "@/lib/workflow-graph"
import { GATE_META, INTENT_META, INTENT_ORDER } from "@/lib/workflow-intents"
import { useAppStore } from "@/store/app-store"
import type {
  AgentTaskConfig,
  Intent,
  NodeKind,
  NodeRunStatus,
  RunStatus,
  Workflow,
  WorkflowGraph,
  WorkflowRun,
} from "@/types/workflow"

import { AgentNode, type AgentNodeData } from "./agent-node"
import { GateNode } from "./gate-node"
import { NodePalette } from "./node-palette"

const nodeTypes = { agent: AgentNode, gate: GateNode }

// Colored status chip (shares the workflows table's color language): a tinted
// fill + ring, with the dot echoing the state color. Covers run statuses and
// node statuses — the editor renders both with the same pill.
const STATUS_PILL: Record<
  RunStatus | NodeRunStatus,
  { label: string; dot: string; pill: string }
> = {
  pending: {
    label: "Pending",
    dot: "bg-muted-foreground/40",
    pill: "bg-muted/60 text-muted-foreground ring-border",
  },
  running: {
    label: "Running",
    dot: "bg-blue-500",
    pill: "bg-blue-500/10 text-blue-400 ring-blue-500/30",
  },
  done: {
    label: "Done",
    dot: "bg-emerald-500",
    pill: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30",
  },
  completed: {
    label: "Done",
    dot: "bg-emerald-500",
    pill: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30",
  },
  failed: {
    label: "Failed",
    dot: "bg-red-500",
    pill: "bg-red-500/10 text-red-400 ring-red-500/30",
  },
  paused: {
    label: "Paused",
    dot: "bg-amber-500",
    pill: "bg-amber-500/10 text-amber-400 ring-amber-500/30",
  },
  awaitingInput: {
    label: "Needs input",
    dot: "bg-amber-500",
    pill: "bg-amber-500/10 text-amber-400 ring-amber-500/30",
  },
  skipped: {
    label: "Skipped",
    dot: "bg-muted-foreground/40",
    pill: "bg-muted/50 text-muted-foreground ring-border",
  },
  canceled: {
    label: "Canceled",
    dot: "bg-muted-foreground/40",
    pill: "bg-muted/50 text-muted-foreground ring-border",
  },
}

function StatusPill({
  status,
  pulse,
}: {
  status: RunStatus | NodeRunStatus
  pulse?: boolean
}) {
  const s = STATUS_PILL[status]
  return (
    <span
      className={cn(
        "flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 font-medium text-[11px] shadow-sm ring-1 ring-inset backdrop-blur",
        s.pill
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", s.dot, pulse && "animate-pulse")}
      />
      {s.label}
    </span>
  )
}

/** A settled run's wall-clock duration, like "3m 12s". */
function runDuration(r: WorkflowRun): string | null {
  const ms = Date.parse(r.updatedAt) - Date.parse(r.createdAt)
  if (!Number.isFinite(ms) || ms < 1000) return null
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

const DEFAULT_MODEL = "claude-opus-4-8"

function defaultConfig(intent: Intent): AgentTaskConfig {
  return {
    intent,
    model: DEFAULT_MODEL,
    effort: "high",
    prompt: "",
    branchHint: null,
    permissionMode: null,
  }
}

type AgentKind = Extract<NodeKind, { type: "agentTask" }>

function configFromKind(kind: AgentKind): AgentTaskConfig {
  return {
    intent: kind.intent,
    model: kind.model,
    effort: kind.effort,
    prompt: kind.prompt,
    branchHint: kind.branchHint ?? null,
    permissionMode: kind.permissionMode ?? null,
  }
}

function toRF(
  graph: WorkflowGraph,
  workflowId: string
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const kept = new Set<string>()
  graph.nodes.forEach((n, i) => {
    const position = n.position ?? { x: 140, y: 80 + i * 150 }
    if (n.kind.type === "gate") {
      nodes.push({ id: n.id, type: "gate", position, data: { workflowId } })
      kept.add(n.id)
    } else if (n.kind.type === "agentTask") {
      nodes.push({
        id: n.id,
        type: "agent",
        position,
        data: { label: n.label, config: configFromKind(n.kind), workflowId },
      })
      kept.add(n.id)
    }
  })
  // Drop edges whose endpoint wasn't materialized (e.g. a legacy start node),
  // so React Flow isn't handed dangling references.
  const edges: Edge[] = graph.edges
    .filter((e) => kept.has(e.source) && kept.has(e.target))
    .map((e) => ({ id: e.id, source: e.source, target: e.target }))
  return { nodes, edges }
}

function toGraph(nodes: Node[], edges: Edge[]): WorkflowGraph {
  return {
    nodes: nodes.map((n) => {
      if (n.type === "gate") {
        return {
          id: n.id,
          label: "User Approval",
          position: n.position,
          kind: { type: "gate" },
        }
      }
      const d = n.data as AgentNodeData
      return {
        id: n.id,
        label: d.label,
        position: n.position,
        kind: { type: "agentTask", ...d.config },
      }
    }),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  }
}

function Canvas({ workflow }: { workflow: Workflow }) {
  const saveWorkflowGraph = useAppStore((s) => s.saveWorkflowGraph)
  const runWorkflowById = useAppStore((s) => s.runWorkflowById)
  const cancelWorkflow = useAppStore((s) => s.cancelWorkflow)
  const resumeRun = useAppStore((s) => s.resumeRun)
  const retryRun = useAppStore((s) => s.retryRun)
  const loadRunById = useAppStore((s) => s.loadRunById)
  const loadWorkflowRun = useAppStore((s) => s.loadWorkflowRun)
  const workflowRun = useAppStore((s) => s.workflowRun)
  const loadEvents = useAppStore((s) => s.loadEvents)
  const openSession = useAppStore((s) => s.openSession)
  const renameWorkflow = useAppStore((s) => s.renameWorkflow)
  const duplicateWorkflow = useAppStore((s) => s.duplicateWorkflow)
  const exportWorkflow = useAppStore((s) => s.exportWorkflow)
  const deleteWorkflow = useAppStore((s) => s.deleteWorkflow)
  const openWorkflow = useAppStore((s) => s.openWorkflow)
  const confirm = useConfirm()

  // The store holds one live run view globally; only trust it when it belongs
  // to this workflow, so a background run can't paint status into this canvas.
  const run = workflowRun?.run.workflowId === workflow.id ? workflowRun : null
  const runStatus = run?.run.status

  // Run history (fetched when the status pill's dropdown opens). latestRunId
  // marks whether the canvas is showing a past run instead of the newest one.
  const [runHistory, setRunHistory] = useState<WorkflowRun[]>([])
  const [latestRunId, setLatestRunId] = useState<string | null>(null)
  const viewingPast =
    latestRunId !== null && run !== null && run.run.id !== latestRunId

  const openNodeSession = (sessionId: string | null | undefined) => {
    if (!sessionId) return
    openSession(sessionId)
  }

  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(workflow.name)
  const commitRename = () => {
    const name = nameDraft.trim()
    if (name && name !== workflow.name) void renameWorkflow(workflow.id, name)
    setRenaming(false)
  }

  const [initial] = useState(() => toRF(workflow.graph, workflow.id))
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Debounced autosave; the unmount flush below makes sure closing the tab
  // within the debounce window can't drop the last edits.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef(false)
  const latest = useRef({ nodes, edges })
  latest.current = { nodes, edges }
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    pendingSave.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      pendingSave.current = false
      void saveWorkflowGraph(workflow.id, toGraph(nodes, edges))
    }, 600)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [nodes, edges, workflow.id, saveWorkflowGraph])
  useEffect(
    () => () => {
      if (!pendingSave.current) return
      pendingSave.current = false
      const g = latest.current
      void saveWorkflowGraph(workflow.id, toGraph(g.nodes, g.edges))
    },
    [workflow.id, saveWorkflowGraph]
  )

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge(c, eds)),
    [setEdges]
  )
  // Refuse self-loops and anything that would close a cycle — the executor
  // rejects cyclic graphs, so don't let them be drawn in the first place.
  const isValidConnection = useCallback(
    (c: Connection | Edge) =>
      !!c.source && !!c.target && !createsCycle(edges, c.source, c.target),
    [edges]
  )

  // Create a node (optionally at a position, optionally wired from a source).
  const createNode = (
    kind: Intent | "gate",
    position?: { x: number; y: number },
    connectFrom?: string
  ) => {
    const id = crypto.randomUUID()
    setNodes((ns) => {
      const pos = position ?? {
        x: 160 + ns.length * 24,
        y: 120 + ns.length * 24,
      }
      const node: Node =
        kind === "gate"
          ? {
              id,
              type: "gate",
              position: pos,
              data: { workflowId: workflow.id },
            }
          : {
              id,
              type: "agent",
              position: pos,
              data: {
                label: INTENT_META[kind].label,
                config: defaultConfig(kind),
                workflowId: workflow.id,
              },
            }
      return [...ns, node]
    })
    if (connectFrom) {
      setEdges((es) =>
        addEdge(
          {
            source: connectFrom,
            target: id,
            sourceHandle: null,
            targetHandle: null,
          },
          es
        )
      )
    }
    setSelectedId(id)
  }

  // Drag a connection off into empty canvas → palette + auto-connect. Also
  // opened by right-clicking the canvas (no source).
  const { screenToFlowPosition, deleteElements } = useReactFlow()
  const connectingFrom = useRef<string | null>(null)
  const [palette, setPalette] = useState<{
    screen: { x: number; y: number }
    flow: { x: number; y: number }
    connectFrom?: string
  } | null>(null)

  const openPaletteAt = (clientX: number, clientY: number, from?: string) => {
    setPalette({
      screen: { x: clientX, y: clientY },
      flow: screenToFlowPosition({ x: clientX, y: clientY }),
      connectFrom: from,
    })
  }

  // While dragging a connection into empty space, follow the cursor with a
  // "Place a new node" hint (mirrors Unreal's blueprint editor).
  const [connectHint, setConnectHint] = useState<{
    x: number
    y: number
  } | null>(null)
  const hintShown = connectHint !== null
  useEffect(() => {
    if (!hintShown) return
    const move = (e: PointerEvent) =>
      setConnectHint({ x: e.clientX, y: e.clientY })
    window.addEventListener("pointermove", move)
    return () => window.removeEventListener("pointermove", move)
  }, [hintShown])

  const onConnectStart: OnConnectStart = (event, params) => {
    connectingFrom.current = params.nodeId ?? null
    const point = "clientX" in event ? event : (event as TouchEvent).touches[0]
    if (point) setConnectHint({ x: point.clientX, y: point.clientY })
  }
  const onConnectEnd: OnConnectEnd = (event, state) => {
    const from = connectingFrom.current
    connectingFrom.current = null
    setConnectHint(null)
    if (state.isValid || !from) return
    // Released over a node means a refused connection (e.g. a cycle), not a
    // "place a new node here" gesture.
    if (state.toNode) return
    const point = "clientX" in event ? event : event.changedTouches[0]
    openPaletteAt(point.clientX, point.clientY, from)
  }
  const onPaneContextMenu = (event: ReactMouseEvent | MouseEvent) => {
    event.preventDefault()
    openPaletteAt(event.clientX, event.clientY)
  }
  const openAddPalette = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const r = event.currentTarget.getBoundingClientRect()
    openPaletteAt(r.left, r.bottom + 6)
  }

  const selected = nodes.find((n) => n.id === selectedId) ?? null
  const selectedMeta = selected
    ? selected.type === "gate"
      ? GATE_META
      : INTENT_META[(selected.data as AgentNodeData).config.intent]
    : null
  const [panelTab, setPanelTab] = useState<"config" | "output">("config")
  const nodeRun = selected
    ? (run?.nodes.find((n) => n.nodeId === selected.id) ?? null)
    : null
  const nodeSessionId = nodeRun?.sessionId ?? null
  const hasRunInfo = nodeRun != null && nodeRun.status !== "pending"
  // Selecting a node with nothing to show on Output falls back to Config.
  useEffect(() => {
    if (!hasRunInfo) setPanelTab("config")
  }, [hasRunInfo])
  useEffect(() => {
    if (panelTab === "output" && nodeSessionId) void loadEvents(nodeSessionId)
  }, [panelTab, nodeSessionId, loadEvents])

  const patchData = (patch: Record<string, unknown>) =>
    setNodes((ns) =>
      ns.map((n) =>
        n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n
      )
    )
  const patchConfig = (patch: Partial<AgentTaskConfig>) => {
    const cfg = (selected?.data as AgentNodeData | undefined)?.config
    if (cfg) patchData({ config: { ...cfg, ...patch } })
  }

  const deleteSelectedNode = () => {
    if (!selectedId) return
    const id = selectedId
    setSelectedId(null)
    void deleteElements({ nodes: [{ id }] })
  }

  const startRun = async () => {
    // Surface a missing required prompt now instead of running a blank task.
    const missing = nodes.find((n) => {
      if (n.type !== "agent") return false
      const d = n.data as AgentNodeData
      return (
        INTENT_META[d.config.intent].promptRequired && !d.config.prompt.trim()
      )
    })
    if (missing) {
      const d = missing.data as AgentNodeData
      const meta = INTENT_META[d.config.intent]
      toast.error(`"${d.label || meta.label}" needs more detail`, {
        description: `Fill in "${meta.promptLabel}" before running.`,
      })
      setSelectedId(missing.id)
      setPanelTab("config")
      return
    }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    pendingSave.current = false
    // A fresh run becomes the latest, so the past-run marker is stale.
    setLatestRunId(null)
    await saveWorkflowGraph(workflow.id, toGraph(nodes, edges))
    void runWorkflowById(workflow.id)
  }

  const running = runStatus === "running"
  // Paused counts too: a second concurrent run of the same workflow is refused.
  const activeRun = running || runStatus === "paused"

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onPaneContextMenu={onPaneContextMenu}
            onEdgeContextMenu={(e, edge) => {
              e.preventDefault()
              void deleteElements({ edges: [{ id: edge.id }] })
            }}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onNodeDoubleClick={(_, n) =>
              openNodeSession(
                run?.nodes.find((r) => r.nodeId === n.id)?.sessionId
              )
            }
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            deleteKeyCode={["Delete", "Backspace"]}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1.25 }}
            className="warden-flow"
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />

            {/* Title — floating top-left, like the zoom controls. */}
            <Panel position="top-left" className="flex items-center gap-2">
              {renaming ? (
                <div className="relative flex items-center">
                  <input
                    // biome-ignore lint/a11y/noAutofocus: rename starts focused for immediate typing
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename()
                      if (e.key === "Escape") setRenaming(false)
                    }}
                    className="h-9 w-64 rounded-lg border border-border bg-card pr-[3.75rem] pl-2.5 font-semibold text-lg shadow-sm outline-none focus:border-ring"
                  />
                  <div className="absolute right-1 flex items-center gap-0.5">
                    <button
                      type="button"
                      aria-label="Save name"
                      // Keep the input focused so its blur doesn't fire first.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={commitRename}
                      className="flex size-6 items-center justify-center rounded-md text-emerald-500 transition-colors hover:bg-emerald-500/10"
                    >
                      <Check className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Cancel rename"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setRenaming(false)}
                      className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onDoubleClick={() => {
                    setNameDraft(workflow.name)
                    setRenaming(true)
                  }}
                  className="rounded-lg bg-card/80 px-2.5 py-1 font-semibold text-lg shadow-sm ring-1 ring-border/60 backdrop-blur transition-colors hover:bg-card"
                  title="Double-click to rename"
                >
                  {workflow.name}
                </button>
              )}
              {runStatus ? (
                <DropdownMenu
                  onOpenChange={(open) => {
                    if (!open) return
                    void listWorkflowRuns(workflow.id)
                      .then((runs) => {
                        setRunHistory(runs)
                        setLatestRunId(runs[0]?.id ?? null)
                      })
                      .catch(() => {})
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Run history"
                      className="flex cursor-pointer items-center gap-1"
                    >
                      <StatusPill status={runStatus} pulse={running} />
                      <ChevronDown className="size-3 text-muted-foreground/70" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-72">
                    <div className="px-2 py-1.5 font-medium text-[11px] text-muted-foreground">
                      Run history
                    </div>
                    {runHistory.map((r) => (
                      <DropdownMenuItem
                        key={r.id}
                        onSelect={() => void loadRunById(r.id)}
                        className="gap-2 text-[13px]"
                      >
                        <span
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            STATUS_PILL[r.status].dot
                          )}
                        />
                        <span className="flex-1">
                          {STATUS_PILL[r.status].label}
                        </span>
                        {r.id === run?.run.id ? (
                          <span className="text-[10px] text-muted-foreground">
                            viewing
                          </span>
                        ) : null}
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {runDuration(r)}
                        </span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {relativeTime(r.createdAt)}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {viewingPast ? (
                <button
                  type="button"
                  onClick={() => {
                    setLatestRunId(null)
                    void loadWorkflowRun(workflow.id)
                  }}
                  className="rounded-lg bg-card/80 px-2 py-1 font-medium text-[11px] text-muted-foreground shadow-sm ring-1 ring-border/60 backdrop-blur transition-colors hover:bg-card hover:text-foreground"
                >
                  Viewing a past run · Back to latest
                </button>
              ) : null}
            </Panel>

            {/* Actions — floating top-right. */}
            <Panel position="top-right" className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="lg"
                className="gap-1.5 shadow-sm"
                onClick={openAddPalette}
              >
                <Plus className="size-4" />
                Add node
              </Button>
              {activeRun ? (
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => void cancelWorkflow(workflow.id)}
                  className="gap-1.5 text-red-500 shadow-sm hover:text-red-500"
                >
                  <Square className="size-3.5 fill-current" />
                  Stop
                </Button>
              ) : null}
              {run && runStatus === "failed" ? (
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => {
                    setLatestRunId(null)
                    void retryRun(run.run.id)
                  }}
                  className="gap-1.5 shadow-sm"
                  title="Re-run the unfinished steps; completed ones are kept"
                >
                  <RotateCcw className="size-3.5" />
                  Retry
                </Button>
              ) : null}
              <Button
                size="lg"
                onClick={() => void startRun()}
                disabled={nodes.length === 0 || activeRun}
                className="gap-2 bg-emerald-600 px-5 font-semibold text-white shadow-sm shadow-emerald-900/20 hover:bg-emerald-600/90"
              >
                {running ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4 fill-current" />
                )}
                {running ? "Running" : "Run"}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon-lg"
                    aria-label="Workflow actions"
                    className="text-muted-foreground shadow-sm hover:text-foreground"
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    onSelect={() => {
                      setNameDraft(workflow.name)
                      setRenaming(true)
                    }}
                  >
                    <Pencil className="size-3.5" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      void duplicateWorkflow(workflow.id).then(
                        (c) => c && openWorkflow(c.id)
                      )
                    }
                  >
                    <Copy className="size-3.5" />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void exportWorkflow(workflow.id)}
                  >
                    <Upload className="size-3.5" />
                    Export
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={async () => {
                      if (
                        await confirm({
                          title: "Delete workflow?",
                          description: `"${workflow.name}" will be permanently deleted.`,
                          confirmLabel: "Delete",
                          destructive: true,
                        })
                      ) {
                        void deleteWorkflow(workflow.id)
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Panel>
          </ReactFlow>
        </div>

        {selected && selectedMeta ? (
          <aside className="flex w-96 shrink-0 flex-col border-l border-border/60">
            {/* Identity header: what the node is, plus delete/close. */}
            <div className="flex shrink-0 items-center gap-2.5 border-b border-border/60 p-3">
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg",
                  selectedMeta.tile
                )}
              >
                <selectedMeta.icon
                  className={cn("size-4", selectedMeta.accent)}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-[13px]">
                  {selected.type === "gate"
                    ? selectedMeta.label
                    : (selected.data as AgentNodeData).label ||
                      selectedMeta.label}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {selectedMeta.description}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete node"
                onClick={deleteSelectedNode}
                className="text-muted-foreground hover:text-red-500"
              >
                <Trash2 className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close panel"
                onClick={() => setSelectedId(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </Button>
            </div>

            {selected.type === "gate" ? (
              <div className="space-y-3 overflow-y-auto p-3">
                {nodeRun ? (
                  <div className="flex items-center justify-between">
                    <StatusPill
                      status={nodeRun.status}
                      pulse={nodeRun.status === "running"}
                    />
                    {nodeRun.status === "paused" ? (
                      <div className="flex gap-1.5">
                        <Button
                          size="xs"
                          onClick={() => void resumeRun(true, run?.run.id)}
                          className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600/90"
                        >
                          <Check className="size-3" />
                          Approve
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => void resumeRun(false, run?.run.id)}
                          className="gap-1 text-red-500 hover:bg-red-500/10 hover:text-red-500"
                        >
                          <X className="size-3" />
                          Reject
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {nodeRun?.error ? (
                  <Callout variant="destructive" size="sm">
                    {nodeRun.error}
                  </Callout>
                ) : null}
                <Callout size="sm">
                  The run pauses here until you approve. Rejecting cancels the
                  rest of the run.
                </Callout>
              </div>
            ) : (
              <>
                <div className="flex shrink-0 items-center gap-1 border-b border-border/60 p-1.5">
                  <button
                    type="button"
                    onClick={() => setPanelTab("config")}
                    className={cn(
                      "flex-1 rounded-md px-2 py-1 font-medium text-xs transition",
                      panelTab === "config"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Config
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanelTab("output")}
                    disabled={!hasRunInfo}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 font-medium text-xs transition disabled:opacity-40",
                      panelTab === "output"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Output
                    {nodeRun?.error ? (
                      <span className="size-1.5 rounded-full bg-red-500" />
                    ) : null}
                  </button>
                </div>
                {panelTab === "config" ? (
                  <div className="space-y-3 overflow-y-auto p-3">
                    <div className="space-y-1">
                      <span className="font-medium text-[11px] text-muted-foreground">
                        Label
                      </span>
                      <Input
                        value={(selected.data as AgentNodeData).label}
                        onChange={(e) => patchData({ label: e.target.value })}
                        className="h-8 text-[13px]"
                      />
                    </div>
                    <AgentConfig
                      config={(selected.data as AgentNodeData).config}
                      patchConfig={patchConfig}
                    />
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                      {nodeRun ? (
                        <StatusPill
                          status={nodeRun.status}
                          pulse={nodeRun.status === "running"}
                        />
                      ) : (
                        <span />
                      )}
                      {nodeSessionId ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => openNodeSession(nodeSessionId)}
                          className="gap-1.5 text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="size-3.5" />
                          Open full session
                        </Button>
                      ) : null}
                    </div>
                    {nodeRun?.error ? (
                      <Callout
                        variant="destructive"
                        size="sm"
                        className="mx-3 mt-3 shrink-0"
                      >
                        {nodeRun.error}
                      </Callout>
                    ) : null}
                    {nodeSessionId ? (
                      <div className="relative min-h-0 flex-1">
                        <Transcript sessionId={nodeSessionId} bottomInset={0} />
                      </div>
                    ) : nodeRun?.output?.trim() ? (
                      <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap p-3 text-muted-foreground text-xs">
                        {nodeRun.output}
                      </div>
                    ) : (
                      <p className="p-6 text-center text-muted-foreground text-xs">
                        No output for this node yet.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </aside>
        ) : null}
      </div>

      {palette ? (
        <NodePalette
          screen={palette.screen}
          onPick={(kind) => {
            createNode(kind, palette.flow, palette.connectFrom)
            setPalette(null)
          }}
          onClose={() => setPalette(null)}
        />
      ) : null}

      {connectHint ? (
        <div
          className="pointer-events-none fixed z-50 flex items-center gap-1.5 rounded-lg border border-border bg-popover/95 px-2.5 py-1.5 text-muted-foreground text-xs shadow-md backdrop-blur"
          style={{ left: connectHint.x + 16, top: connectHint.y + 14 }}
        >
          <Plus className="size-3.5" />
          Place a new node
        </div>
      ) : null}
    </div>
  )
}

/** The intent-driven config for an agent node. */
function AgentConfig({
  config,
  patchConfig,
}: {
  config: AgentTaskConfig
  patchConfig: (patch: Partial<AgentTaskConfig>) => void
}) {
  const meta = INTENT_META[config.intent]
  const IntentIcon = meta.icon
  return (
    <>
      <div className="space-y-1">
        <span className="font-medium text-[11px] text-muted-foreground">
          Does
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-left text-[13px] hover:bg-muted/40"
            >
              <IntentIcon className={cn("size-4", meta.accent)} />
              <span className="flex-1">{meta.label}</span>
              <span className="text-[10px] text-muted-foreground">
                {meta.description}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            {INTENT_ORDER.map((intent) => {
              const m = INTENT_META[intent]
              const Icon = m.icon
              return (
                <DropdownMenuItem
                  key={intent}
                  // Clear the mode override: it's a Custom-only knob, and a
                  // stale bypassPermissions must not follow the node into a
                  // read-only intent like Review.
                  onSelect={() => patchConfig({ intent, permissionMode: null })}
                  className="gap-2"
                >
                  <Icon className={cn("size-4", m.accent)} />
                  {m.label}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-1.5">
        <ModelMenu
          value={config.model}
          onChange={(model) => patchConfig({ model })}
          backend={backendForModel(config.model)}
          started={false}
        />
        <EffortMenu
          value={config.effort}
          onChange={(effort) => patchConfig({ effort })}
          backend={backendForModel(config.model)}
        />
        {config.intent === "custom" ? (
          <ModeMenu
            // Mirror the backend default for Custom (acceptEdits), so the menu
            // never shows a scarier mode than the one that actually runs.
            value={config.permissionMode ?? "acceptEdits"}
            onChange={(permissionMode) => patchConfig({ permissionMode })}
          />
        ) : null}
      </div>

      <div className="space-y-1">
        <span className="font-medium text-[11px] text-muted-foreground">
          {meta.promptLabel}
        </span>
        <textarea
          value={config.prompt}
          onChange={(e) => patchConfig({ prompt: e.target.value })}
          rows={meta.promptRequired ? 5 : 3}
          placeholder={meta.promptPlaceholder}
          className="w-full resize-none rounded-md border border-border/60 bg-transparent px-2.5 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground/60 focus-visible:border-border"
        />
        {meta.promptRequired && !config.prompt.trim() ? (
          <p className="text-[11px] text-amber-500">
            Required before the workflow can run.
          </p>
        ) : null}
      </div>

      {meta.writesCode ? (
        <div className="space-y-1">
          <span className="font-medium text-[11px] text-muted-foreground">
            Branch (optional)
          </span>
          <Input
            value={config.branchHint ?? ""}
            onChange={(e) =>
              patchConfig({ branchHint: e.target.value || null })
            }
            placeholder="defaults to the run's branch"
            className="h-8 font-mono text-[12px]"
          />
        </div>
      ) : (
        <Callout>
          Read-only. Researches and hands its result to the next node.
        </Callout>
      )}
    </>
  )
}

export function WorkflowEditor({ workflowId }: { workflowId: string }) {
  const workflow = useAppStore((s) => s.workflows[workflowId])
  const ensureWorkflow = useAppStore((s) => s.ensureWorkflow)
  const loadWorkflowRun = useAppStore((s) => s.loadWorkflowRun)

  useEffect(() => {
    void ensureWorkflow(workflowId)
    void loadWorkflowRun(workflowId)
  }, [workflowId, ensureWorkflow, loadWorkflowRun])

  if (!workflow) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Loading workflow…
      </div>
    )
  }
  return (
    <ReactFlowProvider>
      <Canvas key={workflow.id} workflow={workflow} />
    </ReactFlowProvider>
  )
}
