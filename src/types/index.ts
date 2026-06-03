export type Backend = "claude"

export type PermissionMode =
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "default"

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max"

export type SessionStatus = "idle" | "running" | "error"

export interface FileEntry {
  path: string
  name: string
}

export interface SlashCommand {
  name: string
  description: string | null
  scope: string
}

export interface RepoRef {
  number: number
  title: string
  kind: "issue" | "pr"
}

export interface RepoRefBody {
  title: string
  body: string
}

export type SessionRole = "chat" | "planner" | "coder"
export type SessionKind = "agent" | "terminal"

export interface Project {
  id: string
  name: string
  path: string
  isGit: boolean
  createdAt: string
}

/** A pane layout saved on a group. `panes` maps each grid cell to a session id
 *  (or null when empty); its length matches the mode's cell count. */
export type LayoutMode = "single" | "cols-2" | "rows-2" | "three" | "grid-4"

export interface Layout {
  mode: LayoutMode
  panes: (string | null)[]
}

/** A group's full persisted view-state: its layout plus which tabs are open
 *  and which is focused. Stored (serialized) in `Group.layout`. */
export interface GroupView extends Layout {
  /** Open tab session ids, in order. */
  openTabs: string[]
  /** The focused session id (must be one of `openTabs`), or null. */
  activeSession: string | null
}

/** The top-level workspace: named set of repo roots + a saved pane layout. */
export interface Group {
  id: string
  name: string
  /** Serialized {@link Layout}; parse with `parseLayout`. */
  layout: string
  createdAt: string
}

export interface Session {
  id: string
  groupId: string
  projectId: string
  title: string
  backend: Backend
  model: string
  permissionMode: PermissionMode
  kind: SessionKind
  effort: EffortLevel
  status: SessionStatus
  role: SessionRole
  autoNamed: boolean
  agentSessionId: string | null
  workingDir: string
  branch: string | null
  baseSha: string | null
  isIsolated: boolean
  allowedTools: string[]
  turns: number
  costUsd: number
  parentId: string | null
  createdAt: string
  updatedAt: string
}

export interface RepoStatus {
  projectId: string
  name: string
  path: string
  isPrimary: boolean
  isGit: boolean
  branch: string | null
  ahead: number
  behind: number
  uncommittedAdded: number
  uncommittedRemoved: number
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
  | { type: "permission_request"; denials: ToolDenial[] }
  | { type: "notice"; text: string }
  | { type: "error"; message: string }

/** A tool call the CLI denied; `pattern` is the allowlist token that permits it. */
export interface ToolDenial {
  toolName: string
  pattern: string
  input: unknown
}

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
