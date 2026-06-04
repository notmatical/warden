/** One changed file in a session's diff against its base commit. */
export interface DiffFile {
  path: string
  added: number
  removed: number
  binary: boolean
  /** Unified-diff patch text; empty for binary files. */
  patch: string
}

/** A commit on the session's branch since it forked from base. */
export interface GitCommit {
  sha: string
  subject: string
  author: string
  date: string
}
