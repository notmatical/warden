/**
 * React Query client + query-key factories for all IPC-fetched data.
 *
 * ## Pattern
 *
 * Server state (data that lives in Tauri/SQLite) belongs in React Query.
 * UI state (sidebar width, active tab, pane layout) belongs in Zustand.
 *
 * Usage:
 *   const { data: groups } = useQuery(groupsQuery())
 *   const { data: sessions } = useQuery(sessionsQuery(groupId))
 *
 * Mutations invalidate the relevant keys so consumers re-fetch automatically:
 *   const { mutate } = useMutation({ mutationFn: ipc.createSession,
 *     onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.sessions(groupId) })
 *   })
 *
 * ## Why not everything in Zustand?
 *
 * Zustand slices own their own async fetching today, which means no cache
 * invalidation, no deduplicated in-flight requests, and no stale-while-
 * revalidate. React Query handles all of that for free. Migrate slices
 * incrementally: new data fetching goes through React Query; existing slices
 * thin out over time.
 */

import { QueryClient, queryOptions } from "@tanstack/react-query"
import * as ipc from "./ipc"

// ---------------------------------------------------------------------------
// QueryClient
// ---------------------------------------------------------------------------

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Tauri IPC is always available — no real "network" in the browser sense.
      networkMode: "always",
      // Most app data changes only via mutations we control; keep cache fresh
      // for 30 s to avoid redundant re-fetches on component mount.
      staleTime: 30_000,
      // Don't retry on error — IPC errors are deterministic (not transient).
      retry: false,
      // Refetch when the window regains focus so the app reflects changes made
      // by external tools (e.g. a git push done in the terminal).
      refetchOnWindowFocus: true,
    },
    mutations: {
      networkMode: "always",
    },
  },
})

// ---------------------------------------------------------------------------
// Query-key registry
//
// Centralised so invalidation is always consistent. Every key is a const-tuple
// so TypeScript narrows it correctly and object-key comparisons work.
// ---------------------------------------------------------------------------

export const keys = {
  // Workspace
  groups: () => ["groups"] as const,
  groupRoots: (groupId: string) => ["groups", groupId, "roots"] as const,
  groupSessions: (groupId: string) => ["groups", groupId, "sessions"] as const,

  // Projects
  projects: () => ["projects"] as const,

  // Sessions
  sessions: (projectId: string) => ["sessions", projectId] as const,
  session: (sessionId: string) => ["session", sessionId] as const,
  events: (sessionId: string) => ["events", sessionId] as const,
  contextSources: (sessionId: string) =>
    ["context-sources", sessionId] as const,

  // Git
  gitStatus: (sessionId: string) => ["git-status", sessionId] as const,
  diff: (sessionId: string) => ["diff", sessionId] as const,
  commits: (sessionId: string) => ["commits", sessionId] as const,

  // Workflows
  workflows: (projectId: string) => ["workflows", projectId] as const,
  workflow: (id: string) => ["workflow", id] as const,
  workflowRun: (runId: string) => ["workflow-run", runId] as const,
  workflowSessions: (workflowId: string) =>
    ["workflow-sessions", workflowId] as const,

  // Providers + GitHub
  providers: () => ["providers"] as const,
  githubStatus: () => ["github-status"] as const,
  openPrs: (projectPath: string) => ["open-prs", projectPath] as const,
} as const

// ---------------------------------------------------------------------------
// Query factories
//
// Pass these directly to useQuery() or prefetchQuery(). Keeping the queryFn
// next to the queryKey ensures they never get out of sync.
// ---------------------------------------------------------------------------

export const groupsQuery = () =>
  queryOptions({
    queryKey: keys.groups(),
    queryFn: () => ipc.listGroups(),
    staleTime: Infinity, // groups only change on explicit create/delete
  })

export const groupRootsQuery = (groupId: string) =>
  queryOptions({
    queryKey: keys.groupRoots(groupId),
    queryFn: () => ipc.listGroupRoots(groupId),
  })

export const groupSessionsQuery = (groupId: string) =>
  queryOptions({
    queryKey: keys.groupSessions(groupId),
    queryFn: () => ipc.listGroupSessions(groupId),
  })

export const projectsQuery = () =>
  queryOptions({
    queryKey: keys.projects(),
    queryFn: () => ipc.listProjects(),
    staleTime: Infinity,
  })

export const eventsQuery = (sessionId: string) =>
  queryOptions({
    queryKey: keys.events(sessionId),
    queryFn: () => ipc.getEvents(sessionId),
    // Events are append-only; once loaded they're updated via Tauri push events,
    // not polling. Disable background refetch to avoid overwriting live state.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

export const contextSourcesQuery = (sessionId: string) =>
  queryOptions({
    queryKey: keys.contextSources(sessionId),
    queryFn: () => ipc.listContextSources(sessionId),
  })

export const gitStatusQuery = (sessionId: string) =>
  queryOptions({
    queryKey: keys.gitStatus(sessionId),
    queryFn: () => ipc.sessionGitStatus(sessionId),
    staleTime: 5_000,
  })

export const diffQuery = (sessionId: string) =>
  queryOptions({
    queryKey: keys.diff(sessionId),
    queryFn: () => ipc.getSessionDiff(sessionId),
    staleTime: 5_000,
  })

export const commitsQuery = (sessionId: string) =>
  queryOptions({
    queryKey: keys.commits(sessionId),
    queryFn: () => ipc.getSessionCommits(sessionId),
    staleTime: 5_000,
  })

export const workflowsQuery = (projectId: string) =>
  queryOptions({
    queryKey: keys.workflows(projectId),
    queryFn: () => ipc.listWorkflows(projectId),
  })

export const workflowQuery = (id: string) =>
  queryOptions({
    queryKey: keys.workflow(id),
    queryFn: () => ipc.getWorkflow(id),
    staleTime: Infinity,
  })

export const workflowRunQuery = (runId: string) =>
  queryOptions({
    queryKey: keys.workflowRun(runId),
    queryFn: () => ipc.getWorkflowRun(runId),
  })

export const workflowSessionsQuery = (workflowId: string) =>
  queryOptions({
    queryKey: keys.workflowSessions(workflowId),
    queryFn: () => ipc.listWorkflowSessions(workflowId),
  })

export const providersQuery = () =>
  queryOptions({
    queryKey: keys.providers(),
    queryFn: () => ipc.listProviderStatus(),
    // Providers change only on install/update/auth; short stale time so focus
    // refetch keeps the UI fresh without hammering the filesystem.
    staleTime: 10_000,
  })

export const githubStatusQuery = () =>
  queryOptions({
    queryKey: keys.githubStatus(),
    queryFn: () => ipc.githubStatus(),
    staleTime: 10_000,
  })

export const openPrsQuery = (projectPath: string) =>
  queryOptions({
    queryKey: keys.openPrs(projectPath),
    queryFn: () => ipc.listOpenPrs(projectPath),
    staleTime: 30_000,
  })
