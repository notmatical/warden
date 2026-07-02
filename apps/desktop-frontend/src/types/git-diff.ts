/** One changed file in a session's diff against its base commit. */
export interface DiffFile {
  path: string
  added: number
  removed: number
  binary: boolean
  /** Unified-diff patch text; empty for binary files. */
  patch: string
}

/** One file's full before/after contents for side-by-side rendering. */
export interface FileVersions {
  /** Contents at the base commit; null when the file was added. */
  oldText: string | null
  /** Working-tree contents; null when the file was deleted. */
  newText: string | null
}

/** A commit on the session's branch since it forked from base. */
export interface GitCommit {
  sha: string
  subject: string
  author: string
  date: string
}
