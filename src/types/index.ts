export type Backend = "claude"

export type PermissionMode =
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "default"

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max"

export type SessionStatus = "idle" | "running" | "error"

export type SessionRole = "chat" | "planner" | "coder"

export interface Workspace {
  id: string
  name: string
  path: string
  isGit: boolean
  createdAt: string
}

export interface Session {
  id: string
  workspaceId: string
  title: string
  backend: Backend
  model: string
  permissionMode: PermissionMode
  effort: EffortLevel
  status: SessionStatus
  role: SessionRole
  autoNamed: boolean
  agentSessionId: string | null
  workingDir: string
  branch: string | null
  baseSha: string | null
  isIsolated: boolean
  turns: number
  costUsd: number
  parentId: string | null
  createdAt: string
  updatedAt: string
}

export interface PlanToCodeResult {
  planner: Session
  coder: Session
}

export type AgentEvent =
  | { type: "session_init"; model: string | null; tools: string[] }
  | { type: "user_message"; text: string }
  | { type: "assistant_text"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result"
      tool_use_id: string
      content: string
      is_error: boolean
    }
  | {
      type: "result"
      is_error: boolean
      cost_usd: number | null
      duration_ms: number | null
      num_turns: number | null
    }
  | { type: "notice"; text: string }
  | { type: "error"; message: string }

export interface EventEnvelope {
  id: string
  sessionId: string
  seq: number
  ts: string
}

export type EventRecord = AgentEvent & EventEnvelope

export interface DeltaPayload {
  sessionId: string
  text: string
}
