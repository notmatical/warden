import { type Channel, invoke } from "@tauri-apps/api/core"
import type {
  Attachment,
  Backend,
  ContextSource,
  DeleteCheck,
  EffortLevel,
  EventRecord,
  FileEntry,
  Group,
  Label,
  MergeMode,
  PermissionMode,
  PlanToCodeResult,
  PrContent,
  PrDetails,
  PrInfo,
  Project,
  ProjectLabels,
  Provider,
  ProviderSource,
  ProviderStatus,
  PrSummary,
  RepoRef,
  RepoRefBody,
  RepoStatus,
  Session,
  SessionContextSource,
  SessionKind,
  SessionRole,
  SlashCommand,
  SyncOutcome,
} from "@/types"
import type { DiffFile, FileVersions, GitCommit } from "@/types/git-diff"
import type { Workflow, WorkflowGraph, WorkflowRunView } from "@/types/workflow"

export function listProjects(): Promise<Project[]> {
  return invoke("list_projects")
}

export function openProject(path: string): Promise<Project> {
  return invoke("open_project", { path })
}

export function listSessions(projectId: string): Promise<Session[]> {
  return invoke("list_sessions", { projectId })
}

// ----- providers -----------------------------------------------------------

export function listProviderStatus(): Promise<ProviderStatus[]> {
  return invoke("list_provider_status")
}

/** A model the local OpenCode install can run, as `id` (picker model id) and
 *  `label` (the `provider/model` identifier OpenCode prints). */
export interface OpencodeModel {
  id: string
  label: string
}

export function listOpencodeModels(): Promise<OpencodeModel[]> {
  return invoke("list_opencode_models")
}

export function installProvider(id: Provider): Promise<void> {
  return invoke("install_provider", { id })
}

export function updateProvider(id: Provider): Promise<void> {
  return invoke("update_provider", { id })
}

export function setProviderSource(
  id: Provider,
  source: ProviderSource
): Promise<void> {
  return invoke("set_provider_source", { id, source })
}

// ----- github cli ----------------------------------------------------------

export function githubStatus(): Promise<ProviderStatus> {
  return invoke("github_status")
}

export function installGithubCli(): Promise<void> {
  return invoke("install_github_cli")
}

export function updateGithubCli(): Promise<void> {
  return invoke("update_github_cli")
}

export function setGithubSource(source: ProviderSource): Promise<void> {
  return invoke("set_github_source", { source })
}

// ----- groups --------------------------------------------------------------

export function listGroups(): Promise<Group[]> {
  return invoke("list_groups")
}

export function createGroup(name: string): Promise<Group> {
  return invoke("create_group", { name })
}

export function renameGroup(groupId: string, name: string): Promise<Group> {
  return invoke("rename_group", { groupId, name })
}

export function deleteGroup(groupId: string): Promise<void> {
  return invoke("delete_group", { groupId })
}

export function setGroupLayout(groupId: string, layout: string): Promise<void> {
  return invoke("set_group_layout", { groupId, layout })
}

export function listGroupRoots(groupId: string): Promise<Project[]> {
  return invoke("list_group_roots", { groupId })
}

export function listGroupSessions(groupId: string): Promise<Session[]> {
  return invoke("list_group_sessions", { groupId })
}

export function addGroupRoot(groupId: string, path: string): Promise<Project> {
  return invoke("add_group_root", { groupId, path })
}

export function removeGroupRoot(
  groupId: string,
  projectId: string
): Promise<void> {
  return invoke("remove_group_root", { groupId, projectId })
}

export function listSessionRoots(sessionId: string): Promise<Project[]> {
  return invoke("list_session_roots", { sessionId })
}

export function setSessionRoots(
  sessionId: string,
  projectIds: string[]
): Promise<Project[]> {
  return invoke("set_session_roots", { sessionId, projectIds })
}

export function sessionGitStatus(sessionId: string): Promise<RepoStatus[]> {
  return invoke("session_git_status", { sessionId })
}

/** The browsable https URL for a repo path's origin remote, or null. */
export function repoBrowseUrl(path: string): Promise<string | null> {
  return invoke("repo_browse_url", { path })
}

export function listContextSources(
  sessionId: string
): Promise<SessionContextSource[]> {
  return invoke("list_context_sources", { sessionId })
}

export function addContextSource(
  sessionId: string,
  source: ContextSource
): Promise<SessionContextSource> {
  return invoke("add_context_source", { sessionId, source })
}

export function removeContextSource(
  sessionId: string,
  id: string
): Promise<void> {
  return invoke("remove_context_source", { sessionId, id })
}

export function setContextSourceEnabled(
  sessionId: string,
  id: string,
  enabled: boolean
): Promise<void> {
  return invoke("set_context_source_enabled", { sessionId, id, enabled })
}

export function getSessionDiff(sessionId: string): Promise<DiffFile[]> {
  return invoke("get_session_diff", { sessionId })
}

export function getSessionFileVersions(
  sessionId: string,
  path: string
): Promise<FileVersions> {
  return invoke("get_session_file_versions", { sessionId, path })
}

export function getSessionCommits(
  sessionId: string,
  limit?: number
): Promise<GitCommit[]> {
  return invoke("get_session_commits", { sessionId, limit: limit ?? null })
}

export function syncWorktree(
  sessionId: string,
  mode?: MergeMode
): Promise<SyncOutcome> {
  return invoke("sync_worktree", { sessionId, mode: mode ?? null })
}

/** Push the session's worktree branch to its origin remote. */
export function pushSession(sessionId: string): Promise<void> {
  return invoke("push_session", { sessionId })
}

/** Pull the latest upstream commits onto the session's branch (fetch + merge). */
export function pullSession(sessionId: string): Promise<SyncOutcome> {
  return invoke("pull_session", { sessionId })
}

export function openPullRequest(
  sessionId: string,
  title: string,
  body: string,
  draft?: boolean
): Promise<PrInfo> {
  return invoke("open_pull_request", {
    sessionId,
    title,
    body,
    draft: draft ?? null,
  })
}

export function generatePrContent(sessionId: string): Promise<PrContent> {
  return invoke("generate_pr_content", { sessionId })
}

export function listOpenPrs(projectId: string): Promise<PrSummary[]> {
  return invoke("list_open_prs", { projectId })
}

export function checkoutPr(
  projectId: string,
  number: number,
  model: string
): Promise<Session> {
  return invoke("checkout_pr", { projectId, number, model })
}

export function refreshPrStatus(sessionId: string): Promise<PrInfo | null> {
  return invoke("refresh_pr_status", { sessionId })
}

export function prDetails(sessionId: string): Promise<PrDetails | null> {
  return invoke("pr_details", { sessionId })
}

export function getEvents(sessionId: string): Promise<EventRecord[]> {
  return invoke("get_events", { sessionId })
}

export interface CreateSessionInput {
  projectId: string
  /** Group to create the session in. Omitted → backend resolves/creates one. */
  groupId?: string
  title: string
  model: string
  permissionMode: PermissionMode
  effort?: EffortLevel
  role?: SessionRole
  kind?: SessionKind
  /** Agent backend that powers the session. Defaults to Claude. */
  backend?: Backend
  /** Isolate in a git worktree. Omitted → backend default (agents yes, terminals no). */
  isolate?: boolean
  /** Provider CLI a native terminal session launches instead of the shell. */
  nativeCommand?: string
  /** Run in this exact directory (e.g. a shell inside another session's
   *  worktree) instead of provisioning one. Implies no isolation. */
  workingDir?: string
  /** Linear issue this session works on; drives writeback on PR open/merge. */
  linearIssueId?: string
  /** Worktree branch name (e.g. "feature/WAR-123" derived from an issue). */
  branchHint?: string
}

/** Report window focus; backend pollers tier their cadence off it. */
export function setAppFocusState(focused: boolean): Promise<void> {
  return invoke("set_app_focus_state", { focused })
}

export function createSession(input: CreateSessionInput): Promise<Session> {
  return invoke("create_session", {
    projectId: input.projectId,
    title: input.title,
    model: input.model,
    options: {
      groupId: input.groupId ?? null,
      permissionMode: input.permissionMode,
      effort: input.effort ?? null,
      role: input.role ?? null,
      kind: input.kind ?? null,
      backend: input.backend ?? null,
      isolate: input.isolate ?? null,
      nativeCommand: input.nativeCommand ?? null,
      workingDir: input.workingDir ?? null,
      linearIssueId: input.linearIssueId ?? null,
      branchHint: input.branchHint ?? null,
    },
  })
}

/** The `worktrees` section of `.warden/config.json` (committed to the repo). */
export interface WorktreeConfig {
  /** Commands run in a fresh worktree after it's created, joined with `&&`. */
  setup: string[]
  /** Commands run in a worktree before it's removed. */
  teardown: string[]
}

export function getWorktreeConfig(projectId: string): Promise<WorktreeConfig> {
  return invoke("get_worktree_config", { projectId })
}

export function updateWorktreeConfig(
  projectId: string,
  config: WorktreeConfig
): Promise<WorktreeConfig> {
  return invoke("update_worktree_config", { projectId, config })
}

export interface TerminalEvent {
  event: "output" | "exit"
  data?: string
  code?: number | null
}

export function startTerminal(
  terminalId: string,
  workingDir: string,
  cols: number,
  rows: number,
  onOutput: Channel<TerminalEvent>
): Promise<void> {
  // The launch command (shell vs provider CLI, fresh vs resume) is derived
  // backend-side from the persisted session, so none is passed here.
  return invoke("start_terminal", {
    onOutput,
    terminalId,
    workingDir,
    cols,
    rows,
  })
}

export function terminalWrite(terminalId: string, data: string): Promise<void> {
  return invoke("terminal_write", { terminalId, data })
}

export function terminalResize(
  terminalId: string,
  cols: number,
  rows: number
): Promise<void> {
  return invoke("terminal_resize", { terminalId, cols, rows })
}

export function stopTerminal(terminalId: string): Promise<void> {
  return invoke("stop_terminal", { terminalId })
}

export interface UpdateSessionInput {
  model?: string
  permissionMode?: PermissionMode
  effort?: EffortLevel
}

export function updateSession(
  sessionId: string,
  patch: UpdateSessionInput
): Promise<Session> {
  return invoke("update_session", {
    sessionId,
    model: patch.model ?? null,
    permissionMode: patch.permissionMode ?? null,
    effort: patch.effort ?? null,
  })
}

export function renameSession(
  sessionId: string,
  title: string
): Promise<Session> {
  return invoke("rename_session", { sessionId, title })
}

export function deleteSession(sessionId: string): Promise<void> {
  return invoke("delete_session", { sessionId })
}

/** What deleting this session would destroy, for a risk-aware confirm. */
export function sessionDeleteCheck(sessionId: string): Promise<DeleteCheck> {
  return invoke("session_delete_check", { sessionId })
}

export function setSessionPinned(
  sessionId: string,
  pinned: boolean
): Promise<Session> {
  return invoke("set_session_pinned", { sessionId, pinned })
}

export function loadProjectLabels(projectId: string): Promise<ProjectLabels> {
  return invoke("load_project_labels", { projectId })
}

export function createLabel(
  projectId: string,
  name: string,
  color: string
): Promise<Label> {
  return invoke("create_label", { projectId, name, color })
}

export function updateLabel(
  id: string,
  name: string,
  color: string
): Promise<void> {
  return invoke("update_label", { id, name, color })
}

export function deleteLabel(id: string): Promise<void> {
  return invoke("delete_label", { id })
}

export function setSessionLabels(
  sessionId: string,
  labelIds: string[]
): Promise<void> {
  return invoke("set_session_labels", { sessionId, labelIds })
}

export function setSessionIsolation(
  sessionId: string,
  isolate: boolean
): Promise<Session> {
  return invoke("set_session_isolation", { sessionId, isolate })
}

/** Re-run the repo's worktree setup commands for a session. */
export function retryWorktreeSetup(sessionId: string): Promise<void> {
  return invoke("retry_worktree_setup", { sessionId })
}

/** Clear a failed setup state so the session is usable as-is. */
export function dismissSetupError(sessionId: string): Promise<void> {
  return invoke("dismiss_setup_error", { sessionId })
}

/** `"folder"`, `"terminal"`, or an installed editor id from `listOpenApps`. */
export type OpenTarget = string

export function openIn(target: OpenTarget, path: string): Promise<void> {
  return invoke("open_in", { target, path })
}

/** An editor installed on this machine, offered by the "open in…" menu. */
export interface OpenApp {
  id: string
  name: string
}

export function listOpenApps(): Promise<OpenApp[]> {
  return invoke("list_open_apps")
}

export function sendMessage(
  sessionId: string,
  text: string,
  attachments?: string[]
): Promise<void> {
  return invoke("send_message", {
    sessionId,
    text,
    attachments: attachments ?? null,
  })
}

/** Stage files dropped on the composer; returns records to reference on send. */
export function attachToSession(
  sessionId: string,
  paths: string[]
): Promise<Attachment[]> {
  return invoke("attach_to_session", { sessionId, paths })
}

// ----- workflows -----

export function listWorkflows(projectId: string): Promise<Workflow[]> {
  return invoke("list_workflows", { projectId })
}

export function listWorkflowSessions(workflowId: string): Promise<Session[]> {
  return invoke("list_workflow_sessions", { workflowId })
}

export function getWorkflow(id: string): Promise<Workflow> {
  return invoke("get_workflow", { id })
}

export function createWorkflow(
  projectId: string,
  name: string,
  graph: WorkflowGraph
): Promise<Workflow> {
  return invoke("create_workflow", { projectId, name, graph })
}

export function updateWorkflow(
  id: string,
  name?: string,
  graph?: WorkflowGraph
): Promise<Workflow> {
  return invoke("update_workflow", {
    id,
    name: name ?? null,
    graph: graph ?? null,
  })
}

export function deleteWorkflow(id: string): Promise<void> {
  return invoke("delete_workflow", { id })
}

export function runWorkflow(
  workflowId: string,
  groupId?: string
): Promise<WorkflowRunView> {
  return invoke("run_workflow", { workflowId, groupId: groupId ?? null })
}

export function getWorkflowRun(runId: string): Promise<WorkflowRunView> {
  return invoke("get_workflow_run", { runId })
}

export function getLatestWorkflowRun(
  workflowId: string
): Promise<WorkflowRunView | null> {
  return invoke("get_latest_workflow_run", { workflowId })
}

/** Resume a run paused at a gate: approve to continue, reject to cancel. */
export function resumeWorkflow(
  runId: string,
  approve: boolean
): Promise<WorkflowRunView> {
  return invoke("resume_workflow", { runId, approve })
}

/** Cancel a workflow's latest run (stops the executor + live session). */
export function cancelWorkflow(
  workflowId: string
): Promise<WorkflowRunView | null> {
  return invoke("cancel_workflow", { workflowId })
}

export function cancelSession(sessionId: string): Promise<void> {
  return invoke("cancel_session", { sessionId })
}

export function approveTools(
  sessionId: string,
  patterns: string[]
): Promise<void> {
  return invoke("approve_tools", { sessionId, patterns })
}

export function rejectTools(sessionId: string): Promise<void> {
  return invoke("reject_tools", { sessionId })
}

export function approvePlan(sessionId: string): Promise<void> {
  return invoke("approve_plan", { sessionId })
}

export interface RunPlanToCodeInput {
  projectId: string
  task: string
  plannerModel: string
  coderModel: string
}

export function runPlanToCode(
  input: RunPlanToCodeInput
): Promise<PlanToCodeResult> {
  return invoke("run_plan_to_code", {
    projectId: input.projectId,
    task: input.task,
    plannerModel: input.plannerModel,
    coderModel: input.coderModel,
  })
}

export function listFiles(
  workingDir: string,
  max?: number
): Promise<FileEntry[]> {
  return invoke("list_files", { workingDir, max: max ?? null })
}

export function listCommands(workingDir: string): Promise<SlashCommand[]> {
  return invoke("list_commands", { workingDir })
}

export function listRepoRefs(workingDir: string): Promise<RepoRef[]> {
  return invoke("list_repo_refs", { workingDir })
}

export function fetchRepoRef(
  workingDir: string,
  kind: RepoRef["kind"],
  number: number
): Promise<RepoRefBody> {
  return invoke("fetch_repo_ref", { workingDir, kind, number })
}
