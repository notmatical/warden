import * as ipc from "@/lib/ipc"
import type { RepoRef } from "@/types"

export type MentionChar = "@" | "/" | "#"

const TRIGGERS: readonly MentionChar[] = ["@", "/", "#"]
const WHITESPACE = new Set([" ", "\n", "\t"])
const MAX_REPO_BODY = 2000

export interface ActiveMention {
  char: MentionChar
  /** Index of the trigger char in the textarea value. */
  index: number
  query: string
}

/**
 * Find the active mention at the cursor: scan backward to a trigger char that
 * sits at line start or after whitespace, with no whitespace in between. One
 * pass handles opening, continuing, and editing an existing mention.
 */
export function detectMention(value: string, cursor: number): ActiveMention | null {
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = value[i]
    if (WHITESPACE.has(ch)) return null
    if (TRIGGERS.includes(ch as MentionChar)) {
      const before = value[i - 1]
      if (i === 0 || WHITESPACE.has(before)) {
        return { char: ch as MentionChar, index: i, query: value.slice(i + 1, cursor) }
      }
      return null
    }
  }
  return null
}

export interface MentionItem {
  id: string
  label: string
  detail?: string
  /** Opaque payload consumed by the provider's `resolve`. */
  payload: unknown
}

export interface MentionContext {
  workingDir: string
}

export interface MentionProvider {
  char: MentionChar
  emptyLabel: string
  /** Load the full candidate set (cached by the hook, filtered per keystroke). */
  load: (ctx: MentionContext) => Promise<MentionItem[]>
  /** Text inserted into the prompt when an item is chosen. */
  resolve: (item: MentionItem, ctx: MentionContext) => Promise<string>
}

const fileProvider: MentionProvider = {
  char: "@",
  emptyLabel: "No files",
  async load(ctx) {
    const files = await ipc.listFiles(ctx.workingDir)
    return files.map((file) => ({
      id: file.path,
      label: file.name,
      detail: file.path,
      payload: file.path,
    }))
  },
  async resolve(item) {
    return `@${item.payload as string} `
  },
}

const commandProvider: MentionProvider = {
  char: "/",
  emptyLabel: "No commands",
  async load(ctx) {
    const commands = await ipc.listCommands(ctx.workingDir)
    return commands.map((command) => ({
      id: command.name,
      label: `/${command.name}`,
      detail: command.description ?? command.scope,
      payload: command.name,
    }))
  },
  async resolve(item) {
    return `/${item.payload as string} `
  },
}

const repoRefProvider: MentionProvider = {
  char: "#",
  emptyLabel: "No issues or PRs",
  async load(ctx) {
    const refs = await ipc.listRepoRefs(ctx.workingDir)
    return refs.map((ref) => ({
      id: `${ref.kind}-${ref.number}`,
      label: `#${ref.number}`,
      detail: ref.title,
      payload: ref,
    }))
  },
  async resolve(item, ctx) {
    const ref = item.payload as RepoRef
    try {
      const { title, body } = await ipc.fetchRepoRef(ctx.workingDir, ref.kind, ref.number)
      const clipped =
        body.length > MAX_REPO_BODY
          ? `${body.slice(0, MAX_REPO_BODY)}\n…(truncated)`
          : body
      const label = ref.kind === "pr" ? "PR" : "Issue"
      return `\n\n--- GitHub ${label} #${ref.number}: ${title} ---\n${clipped}\n\n`
    } catch {
      return `#${ref.number} `
    }
  },
}

export const MENTION_PROVIDERS: Record<MentionChar, MentionProvider> = {
  "@": fileProvider,
  "/": commandProvider,
  "#": repoRefProvider,
}

/** Case-insensitive substring filter over an item's label and detail. */
export function filterMentions(items: MentionItem[], query: string): MentionItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items.slice(0, 50)
  return items
    .filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.detail?.toLowerCase().includes(q)
    )
    .slice(0, 50)
}
