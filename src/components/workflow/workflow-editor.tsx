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
  Copy,
  FolderGit2,
  MoreHorizontal,
  Network,
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
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { listWorkflowRuns } from "@/lib/ipc"
import { relativeTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { folderTabId } from "@/lib/viewport"
import { createsCycle } from "@/lib/workflow-graph"
import { INTENT_META } from "@/lib/workflow-intents"
import { useAppStore } from "@/store/app-store"
import type {
  AgentTaskConfig,
  Intent,
  NodeKind,
  Workflow,
  WorkflowGraph,
  WorkflowRun,
} from "@/types/workflow"

import { AgentNode, type AgentNodeData } from "./agent-node"
import { GateNode } from "./gate-node"
import { NodePalette } from "./node-palette"
import { STATUS_PILL } from "./status"

const nodeTypes = { agent: AgentNode, gate: GateNode }

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
    // Flow left-to-right: a horizontal pitch clears a card's width (~352px) for
    // graphs without saved positions, so tall cards don't stack. Dragged
    // positions are respected.
    const position = n.position ?? { x: 80 + i * 440, y: 80 }
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

/** Arrange nodes left-to-right by dependency depth: a node sits one column
 *  right of its deepest parent, and siblings in a column stack with enough
 *  pitch to clear a tall card. Non-destructive — invoked from "Tidy layout". */
function layoutHorizontal(nodes: Node[], edges: Edge[]): Node[] {
  const COL = 440
  const ROW = 360
  const ids = new Set(nodes.map((n) => n.id))
  const parents = new Map<string, string[]>()
  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target)) {
      const arr = parents.get(e.target)
      if (arr) arr.push(e.source)
      else parents.set(e.target, [e.source])
    }
  }
  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (id: string): number => {
    const cached = depth.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0 // cycle guard (graphs are validated acyclic)
    visiting.add(id)
    const ps = parents.get(id) ?? []
    const d = ps.length === 0 ? 0 : Math.max(...ps.map(depthOf)) + 1
    visiting.delete(id)
    depth.set(id, d)
    return d
  }
  const perCol = new Map<number, number>()
  return nodes.map((n) => {
    const col = depthOf(n.id)
    const row = perCol.get(col) ?? 0
    perCol.set(col, row + 1)
    return { ...n, position: { x: 80 + col * COL, y: 80 + row * ROW } }
  })
}

function Canvas({ workflow }: { workflow: Workflow }) {
  const saveWorkflowGraph = useAppStore((s) => s.saveWorkflowGraph)
  const runWorkflowById = useAppStore((s) => s.runWorkflowById)
  const cancelWorkflow = useAppStore((s) => s.cancelWorkflow)
  const retryRun = useAppStore((s) => s.retryRun)
  const workflowRun = useAppStore((s) => s.workflowRun)
  const openSession = useAppStore((s) => s.openSession)
  const renameWorkflow = useAppStore((s) => s.renameWorkflow)
  const duplicateWorkflow = useAppStore((s) => s.duplicateWorkflow)
  const exportWorkflow = useAppStore((s) => s.exportWorkflow)
  const deleteWorkflow = useAppStore((s) => s.deleteWorkflow)
  const openWorkflow = useAppStore((s) => s.openWorkflow)
  const openTab = useAppStore((s) => s.openTab)
  const confirm = useConfirm()

  // The folder this workflow runs in — surfaced by the title so it's never a
  // mystery which repo a run touches.
  const project = useAppStore((s) =>
    Object.values(s.rootsByGroup)
      .flat()
      .find((p) => p.id === workflow.projectId)
  )

  // The store holds one live run view globally; only trust it when it belongs
  // to this workflow, so a background run can't paint status into this canvas.
  const run = workflowRun?.run.workflowId === workflow.id ? workflowRun : null
  const runStatus = run?.run.status

  // Recent runs — a read-only list of the last few, newest first, for timing.
  const [runHistory, setRunHistory] = useState<WorkflowRun[]>([])

  const refreshHistory = useCallback(() => {
    void listWorkflowRuns(workflow.id, 5)
      .then(setRunHistory)
      .catch(() => {})
  }, [workflow.id])

  // Refresh on mount and whenever the live run settles (new runs appear,
  // durations finalize) so the list stays current.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runStatus is an intentional refresh trigger when the live run settles
  useEffect(() => {
    refreshHistory()
  }, [runStatus, refreshHistory])

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

  // Debounced autosave; the unmount flush below makes sure closing the tab
  // within the debounce window can't drop the last edits.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef(false)
  const latest = useRef({ nodes, edges })
  latest.current = { nodes, edges }
  // The last graph we persisted. Selection now lives in the `nodes` array, so
  // selecting a node re-renders without changing the graph — skip those saves.
  const lastSaved = useRef(
    JSON.stringify(toGraph(initial.nodes, initial.edges))
  )
  const persist = useCallback(() => {
    const graph = toGraph(latest.current.nodes, latest.current.edges)
    const serialized = JSON.stringify(graph)
    if (serialized === lastSaved.current) return
    lastSaved.current = serialized
    void saveWorkflowGraph(workflow.id, graph)
  }, [workflow.id, saveWorkflowGraph])
  const mounted = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: nodes/edges are intentional change triggers; persist reads their latest values from a ref
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    pendingSave.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      pendingSave.current = false
      persist()
    }, 600)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [nodes, edges, persist])
  useEffect(
    () => () => {
      if (!pendingSave.current) return
      pendingSave.current = false
      persist()
    },
    [persist]
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
      // Left-to-right flow: a node's position is its top-left and its target
      // handle sits at the left-vertical-center, so drop the left edge at the
      // release point and lift it so that handle lands near the cursor.
      const pos = position
        ? { x: position.x, y: position.y - 130 }
        : { x: 120 + ns.length * 440, y: 100 }
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
      // Select the new node so it opens expanded for immediate editing.
      return [
        ...ns.map((n) => ({ ...n, selected: false })),
        { ...node, selected: true },
      ]
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
  }

  // Drag a connection off into empty canvas → palette + auto-connect. Also
  // opened by right-clicking the canvas (no source).
  const { screenToFlowPosition, deleteElements, fitView } = useReactFlow()

  const tidyLayout = () => {
    setNodes((ns) => layoutHorizontal(ns, edges))
    // Refit once React Flow has the new positions.
    setTimeout(() => fitView({ padding: 0.2, maxZoom: 1.25, duration: 300 }), 0)
  }
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
      // Select the offending node so it opens expanded at the empty field.
      setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === missing.id })))
      return
    }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    pendingSave.current = false
    const graph = toGraph(nodes, edges)
    lastSaved.current = JSON.stringify(graph)
    await saveWorkflowGraph(workflow.id, graph)
    void runWorkflowById(workflow.id)
  }

  const running = runStatus === "running"
  // Paused counts too: a second concurrent run of the same workflow is refused.
  const activeRun = running || runStatus === "paused"
  // A required prompt left empty would run a blank task — disable Run up front
  // (startRun also guards and points the user at the offending node).
  const missingPrompt = nodes.some(
    (n) =>
      n.type === "agent" &&
      INTENT_META[(n.data as AgentNodeData).config.intent].promptRequired &&
      !(n.data as AgentNodeData).config.prompt.trim()
  )

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
            onNodeDoubleClick={(_, n) =>
              openNodeSession(
                run?.nodes.find((r) => r.nodeId === n.id)?.sessionId
              )
            }
            nodeTypes={nodeTypes}
            deleteKeyCode={["Delete", "Backspace"]}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1.25 }}
            className="warden-flow"
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />

            {nodes.length === 0 ? (
              <Panel position="top-center" className="pointer-events-none">
                <div className="mt-24 rounded-lg border border-border/60 bg-card/70 px-3 py-2 text-muted-foreground text-xs shadow-sm backdrop-blur">
                  Right-click the canvas to add a node
                </div>
              </Panel>
            ) : null}

            {/* Run history — a small floating table at bottom-right, in the
                same control language as the zoom buttons. */}
            {runHistory.length > 0 ? (
              <Panel position="bottom-right">
                <div className="nodrag nowheel w-56 overflow-hidden rounded-lg border border-border/60 bg-card/90 shadow-sm ring-1 ring-border/60 backdrop-blur">
                  <div className="border-border/60 border-b bg-card/90 px-2.5 py-1.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                    Recent runs
                  </div>
                  <div className="p-1">
                    {runHistory.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center gap-2 px-2 py-1 text-[11px]"
                      >
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            STATUS_PILL[r.status].dot
                          )}
                        />
                        <span className="flex-1 truncate text-muted-foreground">
                          {STATUS_PILL[r.status].label}
                        </span>
                        <span className="text-[9px] text-muted-foreground/70 tabular-nums">
                          {runDuration(r)}
                        </span>
                        <span className="text-[9px] text-muted-foreground/70 tabular-nums">
                          {relativeTime(r.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>
            ) : null}

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
              {project ? (
                <button
                  type="button"
                  onClick={() => openTab(folderTabId(project.id))}
                  title={`Runs in ${project.path} — open folder`}
                  className="flex items-center gap-1.5 self-stretch rounded-lg bg-card/80 px-2.5 font-medium text-muted-foreground text-sm shadow-sm ring-1 ring-border/60 backdrop-blur transition-colors hover:bg-card hover:text-foreground"
                >
                  <FolderGit2 className="size-3.5 shrink-0" />
                  <span className="max-w-48 truncate">{project.name}</span>
                </button>
              ) : null}
            </Panel>

            {/* Actions — floating top-right. */}
            <Panel position="top-right" className="flex items-center gap-2">
              {run && runStatus === "failed" ? (
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => void retryRun(run.run.id)}
                  className="gap-1.5 shadow-sm"
                  title="Re-run the unfinished steps; completed ones are kept"
                >
                  <RotateCcw className="size-3.5" />
                  Retry
                </Button>
              ) : null}
              {activeRun ? (
                // While running/paused the Run button flips to a destructive
                // Stop, so the workflow is canceled from the same control.
                <Button
                  variant="destructive"
                  size="lg"
                  onClick={() => void cancelWorkflow(workflow.id)}
                  className="gap-2 px-5 font-semibold shadow-sm"
                >
                  <Square className="size-3.5 fill-current" />
                  Stop
                </Button>
              ) : (
                <Button
                  size="lg"
                  onClick={() => void startRun()}
                  disabled={nodes.length === 0 || missingPrompt}
                  title={
                    missingPrompt
                      ? "Fill in every required prompt before running"
                      : undefined
                  }
                  className="gap-2 bg-emerald-600 px-5 font-semibold text-white shadow-sm shadow-emerald-900/20 hover:bg-emerald-600/90"
                >
                  <Play className="size-4 fill-current" />
                  Run
                </Button>
              )}
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
                    onSelect={tidyLayout}
                    disabled={nodes.length === 0}
                  >
                    <Network className="size-3.5" />
                    Tidy layout
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
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
