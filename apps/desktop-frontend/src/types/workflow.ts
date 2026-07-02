import type { EffortLevel, PermissionMode } from "@/types"

/** What an agent node does — carries a built-in behavior; the edge supplies the
 *  content, so downstream nodes need no hand-written task. */
export type Intent = "plan" | "code" | "review" | "revise" | "custom"

export interface AgentTaskConfig {
  intent: Intent
  model: string
  effort: EffortLevel
  /** Feature description (plan/custom) or optional extra instructions. */
  prompt: string
  branchHint?: string | null
  /** Mode override — only honored for custom; other intents always run under
   *  their intent's mode. */
  permissionMode?: PermissionMode | null
}

/** A node's behavior, internally tagged by `type` to match serde. Gate carries
 *  no config — it's a pure user sign-off checkpoint between agent steps. */
export type NodeKind =
  | { type: "start" }
  | ({ type: "agentTask" } & AgentTaskConfig)
  | { type: "gate" }

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
  | "paused"
  | "awaitingInput"

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
