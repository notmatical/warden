// Mirrors the Rust types in src-tauri/src/integrations/linear/client.rs
// (serde camelCase). Kept hand-written like the rest of src/types.

export interface LinearUserRef {
  id: string
  name: string
  email: string | null
  avatarUrl: string | null
}

export interface LinearState {
  id: string
  name: string
  color: string
  /** Linear state category: backlog | unstarted | started | completed | canceled. */
  type: string
}

export interface LinearTeamRef {
  id: string
  key: string
  name: string
}

export interface LinearProjectRef {
  id: string
  name: string
}

export interface LinearIssue {
  id: string
  identifier: string
  title: string
  description: string | null
  /** Linear priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
  priority: number
  url: string
  updatedAt: string
  state: LinearState
  assignee: LinearUserRef | null
  team: LinearTeamRef
  project: LinearProjectRef | null
  labels: string[]
}

export interface LinearComment {
  id: string
  body: string
  createdAt: string
  user: LinearUserRef | null
}

export interface Viewer {
  id: string
  name: string
  email: string | null
}

export interface LinearStatus {
  connected: boolean
}
