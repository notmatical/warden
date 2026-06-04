export type Backend = "claude" | "codex"

/** An agent CLI provider; one-to-one with the session backends. */
export type Provider = Backend

/** Where a provider's CLI is sourced from. */
export type ProviderSource = "auto" | "managed" | "system"

/** A provider's installation/auth snapshot, surfaced by the backend. */
export interface ProviderStatus {
  id: Provider
  name: string
  /** User's source preference. */
  source: ProviderSource
  /** Whether the effective (resolved) binary is present and runnable. */
  installed: boolean
  /** Version of the effective binary. */
  version: string | null
  /** Absolute path of the effective binary. */
  path: string | null
  authed: boolean
  /** Whether a copy exists on the system PATH. */
  systemDetected: boolean
  /** Whether warden's managed copy is installed. */
  managedInstalled: boolean
  /** Version of the managed copy, if installed. */
  managedVersion: string | null
  /** Latest published version (best-effort). */
  latestVersion: string | null
  /** Whether the managed copy is behind the latest published version. */
  updateAvailable: boolean
}

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

export interface RepoComment {
  author: string
  body: string
}

export interface RepoRefBody {
  title: string
  body: string
  comments: RepoComment[]
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
  baseBranch: string | null
  isIsolated: boolean
  allowedTools: string[]
  turns: number
  costUsd: number
  parentId: string | null
  /** Set once the session's branch has been merged back; the worktree is gone. */
  mergedAt: string | null
  /** The pull request opened for this session's branch, if any. */
  prNumber: number | null
  prUrl: string | null
  prState: string | null
  /** Aggregate CI-check state for the PR, refreshed by background polling. */
  prCheckStatus: CheckStatus | null
  prCheckedAt: number | null
  createdAt: string
  updatedAt: string
}

/** Aggregate CI-check state for a PR. */
export type CheckStatus = "success" | "failure" | "pending"

/** How a session's branch is folded into its base when merging. */
export type MergeMode = "squash" | "merge" | "rebase"

/** Result of merging a session's branch back into its base. */
export type IntegrateOutcome =
  | { status: "merged" }
  | { status: "conflict"; files: string[] }

/** Result of syncing a worktree with the latest base branch. */
export type SyncOutcome =
  | { status: "synced" }
  | { status: "conflict"; files: string[] }

/** An open PR in a repo, for the review-checkout picker. */
export interface PrSummary {
  number: number
  title: string
  author: string
  headRef: string
}

/** A generated PR title + body, for review before opening. */
export interface PrContent {
  title: string
  body: string
}

/** A pull request's identity and state, mirrored from `gh`. */
export interface PrInfo {
  number: number
  url: string
  /** GitHub PR state: "OPEN" | "MERGED" | "CLOSED". */
  state: string
  title: string
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
  hasRemote: boolean
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
