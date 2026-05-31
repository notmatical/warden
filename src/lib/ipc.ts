import { invoke } from "@tauri-apps/api/core"

import type {
  DiffResult,
  EventRecord,
  PermissionMode,
  PlanToCodeResult,
  Session,
  SessionRole,
  Workspace,
} from "@/types"

export function listWorkspaces(): Promise<Workspace[]> {
  return invoke("list_workspaces")
}

export function openWorkspace(path: string): Promise<Workspace> {
  return invoke("open_workspace", { path })
}

export function listSessions(workspaceId: string): Promise<Session[]> {
  return invoke("list_sessions", { workspaceId })
}

export function getEvents(sessionId: string): Promise<EventRecord[]> {
  return invoke("get_events", { sessionId })
}

export function getDiff(sessionId: string): Promise<DiffResult> {
  return invoke("get_diff", { sessionId })
}

export interface CreateSessionInput {
  workspaceId: string
  title: string
  model: string
  permissionMode: PermissionMode
  role?: SessionRole
}

export function createSession(input: CreateSessionInput): Promise<Session> {
  return invoke("create_session", {
    workspaceId: input.workspaceId,
    title: input.title,
    model: input.model,
    permissionMode: input.permissionMode,
    role: input.role ?? null,
  })
}

export function sendMessage(sessionId: string, text: string): Promise<void> {
  return invoke("send_message", { sessionId, text })
}

export function cancelSession(sessionId: string): Promise<void> {
  return invoke("cancel_session", { sessionId })
}

export interface RunPlanToCodeInput {
  workspaceId: string
  task: string
  plannerModel: string
  coderModel: string
}

export function runPlanToCode(
  input: RunPlanToCodeInput
): Promise<PlanToCodeResult> {
  return invoke("run_plan_to_code", {
    workspaceId: input.workspaceId,
    task: input.task,
    plannerModel: input.plannerModel,
    coderModel: input.coderModel,
  })
}
