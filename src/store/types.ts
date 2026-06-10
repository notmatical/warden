import type {
  Backend,
  DeltaPayload,
  EffortLevel,
  EventRecord,
  Group,
  IntegrateOutcome,
  Label,
  MergeMode,
  PaneTree,
  PermissionMode,
  PrInfo,
  Project,
  Provider,
  ProviderSource,
  ProviderStatus,
  Session,
  SessionKind,
  SessionRole,
  SyncOutcome,
} from "@/types"
import type {
  RunStatus,
  Workflow,
  WorkflowGraph,
  WorkflowRunView,
} from "@/types/workflow"

export interface CreateSessionOptions {
  projectId: string
  /** Explicit owning group — needed when the same root lives in several
   *  groups; defaults to the first group containing the root. */
  groupId?: string
  title: string
  model: string
  permissionMode: PermissionMode
  effort?: EffortLevel
  role?: SessionRole
  kind?: SessionKind
  backend?: Backend
  isolate?: boolean
  firstMessage?: string
  /** A provider CLI for a native terminal session to launch instead of the shell. */
  nativeCommand?: string
  /** Run in this exact directory (e.g. a shell inside another session's
   *  worktree) instead of provisioning one. */
  workingDir?: string
  /** Linear issue this session works on; drives writeback on PR open/merge. */
  linearIssueId?: string
}

export interface SessionSettingsPatch {
  model?: string
  permissionMode?: PermissionMode
  effort?: EffortLevel
}

export interface RunPlanToCodeOptions {
  task: string
  plannerModel: string
  coderModel: string
}

/** The complete store contract. Each slice creator is typed against this whole
 *  interface (so `get()` reaches every action) but only defines its own portion. */
export interface AppState {
  groups: Group[]
  activeGroupId: string | null
  /** A group's repo roots, ordered. */
  rootsByGroup: Record<string, Project[]>
  /** All session ids in a group (for the sidebar tree, not just open tabs). */
  sessionsByGroup: Record<string, string[]>
  /** Open tabs across every group, in order — the viewport is global. */
  openTabs: string[]
  /** The focused tab ref (must be in `openTabs`), or null. */
  activeTabId: string | null
  /** The global pane arrangement (recursive split-tree). */
  layout: PaneTree
  /** Session id currently being dragged (drives drop zones + the drag clone). */
  draggingSessionId: string | null
  sessions: Record<string, Session>
  /** Install/auth status of each agent CLI provider. */
  providers: ProviderStatus[]
  /** Install/auth status of the GitHub CLI (loaded lazily by Settings). */
  githubStatus: ProviderStatus | null
  eventsBySession: Record<string, EventRecord[]>
  /** permission_request event id the user has acted on, per session — so the
   *  approval bar dismisses on approve/deny. */
  approvalResolvedBySession: Record<string, string>
  streamingBySession: Record<string, string>
  /** Wall-clock start of the in-flight turn, for the live elapsed timer. */
  startedAtBySession: Record<string, number>

  sidebarCollapsed: boolean
  sidebarWidth: number

  /** Remembered section for the Settings tab — restored when it reopens, and
   *  set by `openSettings(section)` deep links. */
  settingsSection: string

  initialized: boolean
  loadingGroups: boolean
  loadingEventsBySession: Record<string, boolean>

  // ----- workflows -----
  workflows: Record<string, Workflow>
  workflowRun: WorkflowRunView | null
  /** workflowId → its node-session ids (for the sidebar's Workflows section). */
  sessionsByWorkflow: Record<string, string[]>
  /** workflowId → its latest run status (powers the sidebar's row accent bar). */
  workflowRunStatusById: Record<string, RunStatus>
  loadWorkflows: (projectId: string) => Promise<void>
  /** Load workflows across every project — powers the global Workflows view and
   *  the sidebar's workflow count badge. */
  loadAllWorkflows: () => Promise<void>
  loadWorkflowSessions: (workflowId: string) => Promise<void>
  ensureWorkflow: (id: string) => Promise<void>
  createWorkflow: (projectId: string, name: string) => Promise<Workflow | null>
  saveWorkflowGraph: (id: string, graph: WorkflowGraph) => Promise<void>
  renameWorkflow: (id: string, name: string) => Promise<void>
  duplicateWorkflow: (id: string) => Promise<Workflow | null>
  /** Copy a workflow to the clipboard as a shareable code. */
  exportWorkflow: (id: string) => Promise<void>
  /** Create a new workflow under `projectId` from a shared code. */
  importWorkflow: (projectId: string, code: string) => Promise<Workflow | null>
  deleteWorkflow: (id: string) => Promise<void>
  openWorkflow: (id: string) => void
  runWorkflowById: (id: string) => Promise<void>
  cancelWorkflow: (id: string) => Promise<void>
  resumeRun: (approve: boolean, runId?: string) => Promise<void>
  loadWorkflowRun: (id: string) => Promise<void>
  applyWorkflowRun: (view: WorkflowRunView) => void

  // ----- labels (per-project, GitHub-style) -----
  labelsByProject: Record<string, Label[]>
  /** sessionId → its attached label ids. */
  labelIdsBySession: Record<string, string[]>
  loadProjectLabels: (projectId: string) => Promise<void>
  createLabel: (
    projectId: string,
    name: string,
    color: string
  ) => Promise<Label | null>
  updateLabel: (id: string, name: string, color: string) => Promise<void>
  deleteLabel: (id: string) => Promise<void>
  setSessionLabels: (sessionId: string, labelIds: string[]) => Promise<void>

  init: () => Promise<void>
  /** Restore the persisted global view once all groups are loaded. */
  restoreView: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setSidebarWidth: (width: number) => void
  loadProviders: () => Promise<void>
  installProvider: (id: Provider) => Promise<void>
  updateProvider: (id: Provider) => Promise<void>
  setProviderSource: (id: Provider, source: ProviderSource) => Promise<void>
  loadGithubStatus: () => Promise<void>
  installGithub: () => Promise<void>
  updateGithub: () => Promise<void>
  setGithubSource: (source: ProviderSource) => Promise<void>
  openSettings: (section?: string) => void
  setSettingsSection: (section: string) => void
  integrateSession: (
    sessionId: string,
    message: string,
    mode: MergeMode
  ) => Promise<IntegrateOutcome | null>
  openPullRequest: (
    sessionId: string,
    title: string,
    body: string,
    draft?: boolean
  ) => Promise<PrInfo | null>
  refreshPrStatus: (sessionId: string) => Promise<PrInfo | null>
  mergePullRequest: (sessionId: string, strategy: MergeMode) => Promise<boolean>
  syncWorktree: (
    sessionId: string,
    mode?: MergeMode
  ) => Promise<SyncOutcome | null>
  checkoutPr: (projectId: string, number: number) => Promise<Session | null>
  loadGroupData: (groupId: string) => Promise<void>
  createGroup: (name: string) => Promise<Group | null>
  selectGroup: (id: string) => Promise<void>
  renameGroup: (id: string, name: string) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  addRoot: (groupId: string) => Promise<void>
  removeRoot: (groupId: string, projectId: string) => Promise<void>
  setLayout: (layout: PaneTree) => void
  /** Drop a session into a pane (by leaf id), opening + focusing it. */
  assignToPane: (leafId: string, sessionId: string) => void
  /** Split a pane (by leaf id) on one edge, placing the session in the new half. */
  splitPane: (
    leafId: string,
    side: "left" | "right" | "top" | "bottom",
    sessionId: string
  ) => void
  setDragging: (sessionId: string | null) => void
  /** Move an open tab to just before another in the strip. */
  reorderTab: (draggedId: string, targetId: string) => void
  /** Persist the global view-state (layout + open tabs + active tab). */
  saveView: () => void
  createSession: (opts: CreateSessionOptions) => Promise<Session | null>
  /** Create a terminal session that launches a provider's CLI natively. */
  createNativeSession: (projectId: string, provider: Provider) => Promise<void>
  openSession: (id: string) => void
  /** Open any content ref (session, workflow, settings, tasks, issues) as a tab. */
  openTab: (ref: string) => void
  updateSession: (
    sessionId: string,
    patch: SessionSettingsPatch
  ) => Promise<void>
  setIsolation: (sessionId: string, isolate: boolean) => Promise<void>
  /** Sessions mid-switch between worktree and checkout (provisioning takes a
   *  beat); the value is the side being switched *to*, for the pending badge. */
  isolationPending: Record<string, "worktree" | "checkout">
  renameSession: (sessionId: string, title: string) => Promise<void>
  deleteSessions: (sessionIds: string[]) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  setSessionPinned: (id: string, pinned: boolean) => Promise<void>
  selectTab: (id: string) => void
  closeTab: (id: string) => void
  closeOthers: (id: string) => void
  sendMessage: (
    sessionId: string,
    text: string,
    attachments?: string[]
  ) => Promise<void>
  cancel: (sessionId: string) => Promise<void>
  approveTools: (sessionId: string, patterns: string[]) => Promise<void>
  approvePlan: (sessionId: string) => Promise<void>
  resolveApproval: (sessionId: string, eventId: string) => void
  runPlanToCode: (opts: RunPlanToCodeOptions) => Promise<void>
  loadEvents: (sessionId: string) => Promise<void>

  onAgentEvent: (record: EventRecord) => void
  onDelta: (payload: DeltaPayload) => void
  onSessionUpdated: (session: Session) => void
}
