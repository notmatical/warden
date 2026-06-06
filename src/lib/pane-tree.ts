import type { Leaf, PaneTree, Split, SplitSide } from "@/types"

/** Recursive split-tree layout engine (VS Code / tmux style). A leaf shows one
 *  session; a split divides space among children along one axis. Every op is
 *  pure — it returns a new tree. */

function uid(): string {
  return crypto.randomUUID()
}

export function makeLeaf(sessionId: string | null = null): Leaf {
  return { type: "leaf", id: uid(), sessionId }
}

/** An empty viewport: a single leaf with nothing in it. */
export function emptyTree(): PaneTree {
  return makeLeaf(null)
}

export function leaves(node: PaneTree): Leaf[] {
  return node.type === "leaf" ? [node] : node.children.flatMap(leaves)
}

export function leafCount(node: PaneTree): number {
  return leaves(node).length
}

export function firstLeaf(node: PaneTree): Leaf {
  return node.type === "leaf" ? node : firstLeaf(node.children[0])
}

export function findSessionLeaf(
  node: PaneTree,
  sessionId: string
): Leaf | undefined {
  return leaves(node).find((l) => l.sessionId === sessionId)
}

export function treeSessionIds(node: PaneTree): Set<string> {
  return new Set(
    leaves(node)
      .map((l) => l.sessionId)
      .filter((id): id is string => id !== null)
  )
}

/** Point a leaf at a different session (or null). */
export function setLeafSession(
  node: PaneTree,
  leafId: string,
  sessionId: string | null
): PaneTree {
  if (node.type === "leaf") {
    return node.id === leafId ? { ...node, sessionId } : node
  }
  return {
    ...node,
    children: node.children.map((c) => setLeafSession(c, leafId, sessionId)),
  }
}

function normalize(sizes: number[]): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0) || 1
  return sizes.map((s) => (s / sum) * 100)
}

/** Remove a leaf, collapsing its parent: a split left with one child is replaced
 *  by that child. Removing the root leaf yields a fresh empty tree. */
export function removeLeaf(node: PaneTree, leafId: string): PaneTree {
  if (node.type === "leaf") {
    return node.id === leafId ? emptyTree() : node
  }
  const kept: PaneTree[] = []
  const sizes: number[] = []
  node.children.forEach((child, i) => {
    if (child.type === "leaf" && child.id === leafId) return // drop it
    kept.push(child.type === "split" ? removeLeaf(child, leafId) : child)
    sizes.push(node.sizes[i])
  })
  if (kept.length === 0) return emptyTree()
  if (kept.length === 1) return kept[0]
  return { ...node, children: kept, sizes: normalize(sizes) }
}

/** Remove a session from the viewport: collapse its pane, or — if it's the only
 *  pane — just clear it (keeping an empty drop zone). */
export function detachSession(node: PaneTree, sessionId: string): PaneTree {
  const leaf = findSessionLeaf(node, sessionId)
  if (!leaf) return node
  if (leafCount(node) === 1) return setLeafSession(node, leaf.id, null)
  return removeLeaf(node, leaf.id)
}

/** Split a leaf, placing `sessionId` on the given side. When the target leaf is
 *  already a child of a split along the same axis, the new pane is inserted as a
 *  sibling (sharing the target's space) rather than nesting a new split. */
export function splitLeaf(
  node: PaneTree,
  leafId: string,
  side: Exclude<SplitSide, "center">,
  sessionId: string | null
): PaneTree {
  const dir: Split["dir"] = side === "left" || side === "right" ? "row" : "col"
  const before = side === "left" || side === "top"
  const fresh = makeLeaf(sessionId)

  const recurse = (n: PaneTree): PaneTree => {
    if (n.type === "leaf") {
      if (n.id !== leafId) return n
      return {
        type: "split",
        id: uid(),
        dir,
        sizes: [50, 50],
        children: before ? [fresh, n] : [n, fresh],
      }
    }
    const idx = n.children.findIndex(
      (c) => c.type === "leaf" && c.id === leafId
    )
    if (idx >= 0 && n.dir === dir) {
      const children = [...n.children]
      const sizes = [...n.sizes]
      const insertAt = before ? idx : idx + 1
      const half = sizes[idx] / 2
      sizes[idx] = half
      children.splice(insertAt, 0, fresh)
      sizes.splice(insertAt, 0, half)
      return { ...n, children, sizes: normalize(sizes) }
    }
    return { ...n, children: n.children.map(recurse) }
  }

  return recurse(node)
}

/** Validate a persisted tree, falling back to an empty viewport. Generates fresh
 *  leaf ids isn't needed — persisted ids are stable and unique. */
export function parseTree(value: unknown): PaneTree {
  const valid = (n: unknown): n is PaneTree => {
    if (!n || typeof n !== "object") return false
    const node = n as Record<string, unknown>
    if (node.type === "leaf") {
      return (
        typeof node.id === "string" &&
        (node.sessionId === null || typeof node.sessionId === "string")
      )
    }
    if (node.type === "split") {
      return (
        typeof node.id === "string" &&
        (node.dir === "row" || node.dir === "col") &&
        Array.isArray(node.sizes) &&
        Array.isArray(node.children) &&
        node.children.length >= 2 &&
        node.children.every(valid)
      )
    }
    return false
  }
  return valid(value) ? value : emptyTree()
}
