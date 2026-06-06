export type Backend = "claude" | "codex"

/** An agent CLI provider; one-to-one with the session backends. */
export type Provider = Backend

/** Where a provider's CLI is sourced from. */
export type ProviderSource = "managed" | "system"

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

/** The viewport pane arrangement: a recursive split-tree (VS Code / tmux style).
 *  A leaf shows one session; a split divides space among children along one axis.
 *  The viewport is global (browser-style), not per-group. */
export interface Leaf {
  type: "leaf"
  id: string
  sessionId: string | null
}

export interface Split {
  type: "split"
  id: string
  dir: "row" | "col"
  /** Percentage size of each child, summing to 100; same length as `children`. */
  sizes: number[]
  children: PaneTree[]
}

export type PaneTree = Leaf | Split

/** Where a dropped session lands relative to a pane: the four edges split it; the
 *  center swaps the pane's session. */
export type SplitSide = "left" | "right" | "top" | "bottom" | "center"

/** The top-level workspace: a named set of repo roots. Organizational only —
 *  the viewport (open tabs + layout) spans every group. */
export interface Group {
  id: string
  name: string
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
  /** For a native CLI terminal, the provider program launched instead of the
   *  shell (`claude`/`codex`); null for plain shell terminals and agents. */
  terminalCommand: string | null
  workingDir: string
  branch: string | null
  baseSha: string | null
  baseBranch: string | null
  isIsolated: boolean
  allowedTools: string[]
  turns: number
  costUsd: number
  parentId: string | null
  /** Set when a workflow run spawned this session. */
  workflowId: string | null
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

/** A piece of context injected into an agent's system prompt for a session. */
export type ContextSource =
  | { kind: "file"; path: string }
  | { kind: "dir"; path: string }
  | { kind: "text"; label: string; body: string }

export interface SessionContextSource {
  id: string
  sessionId: string
  position: number
  enabled: boolean
  source: ContextSource
}

/** A file staged as a per-message composer attachment. */
export interface Attachment {
  id: string
  name: string
  /** The path the agent reads (in place, or a staged copy). */
  path: string
  isImage: boolean
  isDir: boolean
}

/** Token accounting for a turn; the input side + cache approximates context fill. */
export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export type AgentEvent =
  | { type: "session_init"; model: string | null; tools: string[] }
  | { type: "user_message"; text: string }
  | { type: "assistant_text"; text: string; parent_tool_use_id?: string }
  | { type: "text_delta"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "tool_use"
      id: string
      name: string
      input: unknown
      /** Set when this call ran inside a subagent (Task/Agent) — points at that
       *  Task's tool_use id, so the UI can nest the subagent's activity. */
      parent_tool_use_id?: string
    }
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
      usage?: TokenUsage
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
