/** The single source of truth for what *kinds* of content a pane/tab can hold.
 *
 *  A tab/pane references its content by a string `ref`: a bare id is a session
 *  (back-compat); prefixed/sentinel refs are non-session destinations. Every
 *  surface that needs to discriminate content (the viewport store, the pane
 *  headers, the tab strip) goes through `kindOf`/`describeKind` here instead of
 *  hand-rolling `ref.startsWith(...)` checks — so adding a kind is one entry. */

export type ContentKind =
  | "session"
  | "workflow"
  | "workflows"
  | "folder"
  | "settings"
  | "tasks"
  | "issues"
  | "diff"

const WORKFLOW_PREFIX = "workflow:"
const FOLDER_PREFIX = "folder:"
const DIFF_PREFIX = "diff:"

/** Singleton destination ids — there's only ever one tab of each. */
export const SETTINGS_TAB_ID = "settings"
export const WORKFLOWS_TAB_ID = "workflows"
export const TASKS_TAB_ID = "tasks"
export const ISSUES_TAB_ID = "issues"

export function workflowTabId(workflowId: string): string {
  return WORKFLOW_PREFIX + workflowId
}

export function workflowIdOf(ref: string): string {
  return ref.slice(WORKFLOW_PREFIX.length)
}

export function isWorkflowTab(ref: string): boolean {
  return ref.startsWith(WORKFLOW_PREFIX)
}

/** A folder destination: the session list-view for one project (repo root). */
export function folderTabId(projectId: string): string {
  return FOLDER_PREFIX + projectId
}

export function folderIdOf(ref: string): string {
  return ref.slice(FOLDER_PREFIX.length)
}

export function isFolderTab(ref: string): boolean {
  return ref.startsWith(FOLDER_PREFIX)
}

/** A diff destination: the multi-file changes view for one session. */
export function diffTabId(sessionId: string): string {
  return DIFF_PREFIX + sessionId
}

export function diffSessionIdOf(ref: string): string {
  return ref.slice(DIFF_PREFIX.length)
}

export function isDiffTab(ref: string): boolean {
  return ref.startsWith(DIFF_PREFIX)
}

/** Pure, render-free metadata the viewport store needs about a kind. */
export interface KindMeta {
  kind: ContentKind
  /** Singleton kinds have exactly one tab instance (settings/tasks/issues). */
  singleton: boolean
  /** Whether opening/focusing this ref should load agent events (sessions only). */
  loadsEvents: boolean
  /** Whether the ref persists in the saved view without a backing store record.
   *  Sessions must exist; non-session destinations self-hydrate. */
  persistsWithoutRecord: boolean
}

const META: Record<ContentKind, KindMeta> = {
  session: {
    kind: "session",
    singleton: false,
    loadsEvents: true,
    persistsWithoutRecord: false,
  },
  workflow: {
    kind: "workflow",
    singleton: false,
    loadsEvents: false,
    persistsWithoutRecord: true,
  },
  workflows: {
    kind: "workflows",
    singleton: true,
    loadsEvents: false,
    persistsWithoutRecord: true,
  },
  folder: {
    kind: "folder",
    singleton: false,
    loadsEvents: false,
    persistsWithoutRecord: true,
  },
  settings: {
    kind: "settings",
    singleton: true,
    loadsEvents: false,
    persistsWithoutRecord: true,
  },
  tasks: {
    kind: "tasks",
    singleton: true,
    loadsEvents: false,
    persistsWithoutRecord: true,
  },
  issues: {
    kind: "issues",
    singleton: true,
    loadsEvents: false,
    persistsWithoutRecord: true,
  },
  diff: {
    kind: "diff",
    singleton: false,
    loadsEvents: false,
    persistsWithoutRecord: true,
  },
}

/** Resolve a ref to its content kind. `session` is the fallback (bare ids). */
export function kindOf(ref: string): ContentKind {
  if (ref === SETTINGS_TAB_ID) return "settings"
  if (ref === WORKFLOWS_TAB_ID) return "workflows"
  if (ref === TASKS_TAB_ID) return "tasks"
  if (ref === ISSUES_TAB_ID) return "issues"
  if (isFolderTab(ref)) return "folder"
  if (isWorkflowTab(ref)) return "workflow"
  if (isDiffTab(ref)) return "diff"
  return "session"
}

export function describeKind(ref: string): KindMeta {
  return META[kindOf(ref)]
}
