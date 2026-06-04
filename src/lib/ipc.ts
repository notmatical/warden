import { Channel, invoke } from "@tauri-apps/api/core"

import type {
  Backend,
  EffortLevel,
  EventRecord,
  FileEntry,
  Group,
  PermissionMode,
  PlanToCodeResult,
  Provider,
  ProviderSource,
  ProviderStatus,
  RepoRef,
  RepoStatus,
  RepoRefBody,
  Session,
  SessionKind,
  SessionRole,
  SlashCommand,
  Project,
} from "@/types"

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
  /** Run the agent in an isolated git worktree instead of the repo's checkout. */
  isolate?: boolean
  /** Provider CLI a native terminal session launches instead of the shell. */
  nativeCommand?: string
}

export function createSession(input: CreateSessionInput): Promise<Session> {
  return invoke("create_session", {
    projectId: input.projectId,
    groupId: input.groupId ?? null,
    title: input.title,
    model: input.model,
    permissionMode: input.permissionMode,
    effort: input.effort ?? null,
    role: input.role ?? null,
    kind: input.kind ?? null,
    backend: input.backend ?? null,
    isolate: input.isolate ?? false,
    nativeCommand: input.nativeCommand ?? null,
  })
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

export function setSessionIsolation(
  sessionId: string,
  isolate: boolean
): Promise<Session> {
  return invoke("set_session_isolation", { sessionId, isolate })
}

export type OpenTarget = "folder" | "terminal" | "zed" | "vscode"

export function openIn(target: OpenTarget, path: string): Promise<void> {
  return invoke("open_in", { target, path })
}

export function sendMessage(sessionId: string, text: string): Promise<void> {
  return invoke("send_message", { sessionId, text })
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
