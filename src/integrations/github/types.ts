// Mirrors the Rust types in src-tauri/src/integrations/github/issues.rs
// (serde camelCase). Kept hand-written like the rest of src/types.

export interface GhIssue {
  number: number
  title: string
  url: string
  body: string
  labels: string[]
  author: string
  updatedAt: string
}

export interface GhIssueComment {
  author: string
  body: string
  createdAt: string
}

/** A GhIssue tagged with the warden project (repo root) it came from. */
export interface RepoIssue extends GhIssue {
  projectId: string
  projectName: string
}
