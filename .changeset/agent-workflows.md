---
"warden": minor
---

Agent workflows (vertical slice): a visual node-graph editor (React Flow) for composing cross-provider agent workflows. Author a graph of agent-task nodes — each with its own provider/model, permission mode, effort, task prompt, and optional feature branch — connect them, and Run. The backend executes the DAG in order: each node becomes a session, coding nodes share a worktree on a named branch, and each edge hands the upstream node's output to the next as injected context. Node status streams live onto the canvas. Reproduces plan→code as a 2-node graph through the generic engine. (Parallel branches, human-review gates, PR/merge action nodes, and MCP come next.)
