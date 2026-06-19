import { describe, expect, test } from "bun:test"

import type { WorkflowGraph } from "@/types/workflow"

import { createsCycle, remapGraphIds } from "./workflow-graph"

function graph(): WorkflowGraph {
  return {
    nodes: [
      {
        id: "a",
        label: "Code",
        position: { x: 1, y: 2 },
        kind: {
          type: "agentTask",
          intent: "code",
          model: "claude-opus-4-8",
          effort: "high",
          prompt: "",
          branchHint: null,
          permissionMode: null,
        },
      },
      { id: "b", label: "User Approval", kind: { type: "gate" } },
    ],
    edges: [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "a", target: "ghost" },
    ],
  }
}

describe("remapGraphIds", () => {
  test("gives every node and edge a fresh id", () => {
    const out = remapGraphIds(graph())
    expect(out.nodes.map((n) => n.id)).not.toContain("a")
    expect(out.nodes.map((n) => n.id)).not.toContain("b")
    expect(out.edges.map((e) => e.id)).not.toContain("e1")
    expect(out.nodes).toHaveLength(2)
  })

  test("rewires edges to the remapped ids", () => {
    const out = remapGraphIds(graph())
    const [code, gate] = out.nodes
    expect(out.edges[0].source).toBe(code.id)
    expect(out.edges[0].target).toBe(gate.id)
  })

  test("drops edges referencing unknown nodes", () => {
    expect(remapGraphIds(graph()).edges).toHaveLength(1)
  })

  test("preserves labels, kinds, and positions", () => {
    const out = remapGraphIds(graph())
    expect(out.nodes[0].label).toBe("Code")
    expect(out.nodes[0].kind.type).toBe("agentTask")
    expect(out.nodes[0].position).toEqual({ x: 1, y: 2 })
    expect(out.nodes[1].kind.type).toBe("gate")
  })
})

describe("createsCycle", () => {
  const edges = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
  ]

  test("rejects a self-loop", () => {
    expect(createsCycle(edges, "a", "a")).toBe(true)
  })

  test("rejects a direct back-edge", () => {
    expect(createsCycle(edges, "b", "a")).toBe(true)
  })

  test("rejects a transitive cycle", () => {
    expect(createsCycle(edges, "c", "a")).toBe(true)
  })

  test("allows forward and unrelated connections", () => {
    expect(createsCycle(edges, "a", "c")).toBe(false)
    expect(createsCycle(edges, "c", "d")).toBe(false)
    expect(createsCycle([], "a", "b")).toBe(false)
  })
})
