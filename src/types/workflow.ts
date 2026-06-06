import type { EffortLevel, PermissionMode, SessionRole } from "@/types"

/** Per-node agent config (mirrors the Rust `AgentTaskConfig`). */
export interface AgentTaskConfig {
  model: string
  permissionMode: PermissionMode
  effort: EffortLevel
  role: SessionRole
  prompt: string
  branchHint?: string | null
}

/** A node's behavior. Internally tagged by `type` to match serde. */
export type NodeKind =
  | { type: "start" }
  | ({ type: "agentTask" } & AgentTaskConfig)

export interface WorkflowNode {
  id: string
  label: string
  kind: NodeKind
  position?: { x: number; y: number } | null
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
}

export interface WorkflowGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export interface Workflow {
  id: string
  projectId: string
  name: string
  graph: WorkflowGraph
  createdAt: string
  updatedAt: string
}

export type RunStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "canceled"

export type NodeRunStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "skipped"

export interface WorkflowRun {
  id: string
  workflowId?: string | null
  projectId: string
  groupId: string
  status: RunStatus
  error?: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkflowNodeRun {
  runId: string
  nodeId: string
  status: NodeRunStatus
  sessionId?: string | null
  output?: string | null
  error?: string | null
}

export interface WorkflowRunView {
  run: WorkflowRun
  nodes: WorkflowNodeRun[]
}
