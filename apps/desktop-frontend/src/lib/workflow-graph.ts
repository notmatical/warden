import type { WorkflowGraph } from "@/types/workflow"

/** Clone a graph with fresh node/edge ids (rewiring edges to the new ids).
 *  Duplicates and imports must not share ids with the source workflow, or its
 *  run state would light up the copy's nodes. */
export function remapGraphIds(graph: WorkflowGraph): WorkflowGraph {
  const idMap = new Map(graph.nodes.map((n) => [n.id, crypto.randomUUID()]))
  const fresh = (id: string) => idMap.get(id) ?? id
  return {
    nodes: graph.nodes.map((n) => ({ ...n, id: fresh(n.id) })),
    edges: graph.edges
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e) => ({
        id: crypto.randomUUID(),
        source: fresh(e.source),
        target: fresh(e.target),
      })),
  }
}

/** Whether adding `source → target` would close a cycle (the executor rejects
 *  cyclic graphs, so the editor refuses the connection up front). */
export function createsCycle(
  edges: ReadonlyArray<{ source: string; target: string }>,
  source: string,
  target: string
): boolean {
  if (source === target) return true
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    const list = adj.get(e.source)
    if (list) list.push(e.target)
    else adj.set(e.source, [e.target])
  }
  // A cycle forms iff `source` is already reachable from `target`.
  const stack = [target]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const n = stack.pop()
    if (n === undefined) break
    if (n === source) return true
    if (seen.has(n)) continue
    seen.add(n)
    for (const next of adj.get(n) ?? []) stack.push(next)
  }
  return false
}
