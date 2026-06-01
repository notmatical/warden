import { invoke } from "@tauri-apps/api/core"

import type {
  EffortLevel,
  EventRecord,
  FileEntry,
  PermissionMode,
  PlanToCodeResult,
  RepoRef,
  RepoRefBody,
  Session,
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

export function getEvents(sessionId: string): Promise<EventRecord[]> {
  return invoke("get_events", { sessionId })
}

export interface CreateSessionInput {
  projectId: string
  title: string
  model: string
  permissionMode: PermissionMode
  effort?: EffortLevel
  role?: SessionRole
  /** Run the agent in an isolated git worktree instead of the repo's checkout. */
  isolate?: boolean
}

export function createSession(input: CreateSessionInput): Promise<Session> {
  return invoke("create_session", {
    projectId: input.projectId,
    title: input.title,
    model: input.model,
    permissionMode: input.permissionMode,
    effort: input.effort ?? null,
    role: input.role ?? null,
    isolate: input.isolate ?? false,
  })
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
