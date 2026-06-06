import "@xyflow/react/dist/style.css";
import "@/styles/workflow.css";

import {
	addEdge,
	Background,
	type Connection,
	Controls,
	type Edge,
	type Node,
	ReactFlow,
	ReactFlowProvider,
	useEdgesState,
	useNodesState,
} from "@xyflow/react";
import { ArrowLeft, Play, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { EffortMenu } from "@/components/controls/effort-menu";
import { ModeMenu } from "@/components/controls/mode-menu";
import { ModelMenu } from "@/components/controls/model-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/store/app-store";
import type { Backend } from "@/types";
import type {
	AgentTaskConfig,
	NodeKind,
	Workflow,
	WorkflowGraph,
} from "@/types/workflow";

import { AgentNode, type AgentNodeData } from "./agent-node";

const nodeTypes = { agent: AgentNode };

const DEFAULT_CONFIG: AgentTaskConfig = {
	model: "claude-opus-4-8",
	permissionMode: "bypassPermissions",
	effort: "high",
	role: "chat",
	prompt: "",
	branchHint: null,
	writesCode: false,
};

function backendOf(model: string): Backend {
	const id = model.toLowerCase();
	return id.startsWith("gpt") || id.startsWith("codex") ? "codex" : "claude";
}

type RFNode = Node<AgentNodeData>;

function configOf(kind: NodeKind): AgentTaskConfig {
	if (kind.type !== "agentTask") return { ...DEFAULT_CONFIG };
	return {
		model: kind.model,
		permissionMode: kind.permissionMode,
		effort: kind.effort,
		role: kind.role,
		prompt: kind.prompt,
		branchHint: kind.branchHint ?? null,
		writesCode: kind.writesCode,
	};
}

function toRF(graph: WorkflowGraph): { nodes: RFNode[]; edges: Edge[] } {
	const nodes: RFNode[] = graph.nodes
		.filter((n) => n.kind.type === "agentTask")
		.map((n, i) => ({
			id: n.id,
			type: "agent",
			position: n.position ?? { x: 120, y: 80 + i * 140 },
			data: { label: n.label, config: configOf(n.kind) },
		}));
	const edges: Edge[] = graph.edges.map((e) => ({
		id: e.id,
		source: e.source,
		target: e.target,
	}));
	return { nodes, edges };
}

function toGraph(nodes: RFNode[], edges: Edge[]): WorkflowGraph {
	return {
		nodes: nodes.map((n) => ({
			id: n.id,
			label: n.data.label,
			position: n.position,
			kind: { type: "agentTask", ...n.data.config },
		})),
		edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
	};
}

function Canvas({ workflow }: { workflow: Workflow }) {
	const saveWorkflowGraph = useAppStore((s) => s.saveWorkflowGraph);
	const runActiveWorkflow = useAppStore((s) => s.runActiveWorkflow);
	const closeWorkflow = useAppStore((s) => s.closeWorkflow);
	const runStatus = useAppStore((s) => s.workflowRun?.run.status);

	const [initial] = useState(() => toRF(workflow.graph));
	const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	// Debounced persistence on any graph change.
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		if (saveTimer.current) clearTimeout(saveTimer.current);
		saveTimer.current = setTimeout(() => {
			void saveWorkflowGraph(workflow.id, toGraph(nodes, edges));
		}, 600);
		return () => {
			if (saveTimer.current) clearTimeout(saveTimer.current);
		};
	}, [nodes, edges, workflow.id, saveWorkflowGraph]);

	const onConnect = useCallback(
		(c: Connection) => setEdges((eds) => addEdge(c, eds)),
		[setEdges],
	);

	const addNode = () => {
		const id = crypto.randomUUID();
		setNodes((ns) => [
			...ns,
			{
				id,
				type: "agent",
				position: { x: 160 + ns.length * 24, y: 120 + ns.length * 24 },
				data: {
					label: `Step ${ns.length + 1}`,
					config: { ...DEFAULT_CONFIG },
				},
			},
		]);
		setSelectedId(id);
	};

	const selected = nodes.find((n) => n.id === selectedId) ?? null;

	const patchSelected = (patch: Partial<AgentNodeData>) =>
		setNodes((ns) =>
			ns.map((n) =>
				n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n,
			),
		);
	const patchConfig = (patch: Partial<AgentTaskConfig>) =>
		patchSelected({ config: { ...selected!.data.config, ...patch } });

	const run = async () => {
		await saveWorkflowGraph(workflow.id, toGraph(nodes, edges));
		void runActiveWorkflow();
	};

	return (
		<div className="flex h-full flex-col">
			<header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={closeWorkflow}
					aria-label="Back"
				>
					<ArrowLeft />
				</Button>
				<span className="text-sm font-medium">{workflow.name}</span>
				{runStatus ? (
					<span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground tabular-nums">
						{runStatus}
					</span>
				) : null}
				<div className="ml-auto flex items-center gap-1.5">
					<Button variant="ghost" size="sm" onClick={addNode} className="gap-1.5">
						<Plus className="size-3.5" />
						Add node
					</Button>
					<Button
						size="sm"
						onClick={() => void run()}
						disabled={nodes.length === 0 || runStatus === "running"}
						className="gap-1.5 bg-foreground text-background hover:bg-foreground/90"
					>
						<Play className="size-3.5" />
						Run
					</Button>
				</div>
			</header>

			<div className="flex min-h-0 flex-1">
				<div className="min-w-0 flex-1">
					<ReactFlow
						nodes={nodes}
						edges={edges}
						onNodesChange={onNodesChange}
						onEdgesChange={onEdgesChange}
						onConnect={onConnect}
						onNodeClick={(_, n) => setSelectedId(n.id)}
						onPaneClick={() => setSelectedId(null)}
						nodeTypes={nodeTypes}
						fitView
						className="warden-flow"
						proOptions={{ hideAttribution: true }}
					>
						<Background />
						<Controls showInteractive={false} />
					</ReactFlow>
				</div>

				{selected ? (
					<aside className="w-72 shrink-0 space-y-3 overflow-auto border-l border-border/60 p-3">
						<div className="space-y-1">
							<span className="text-[11px] font-medium text-muted-foreground">
								Label
							</span>
							<Input
								value={selected.data.label}
								onChange={(e) => patchSelected({ label: e.target.value })}
								className="h-8 text-[13px]"
							/>
						</div>
						<div className="flex items-center gap-1.5">
							<ModelMenu
								value={selected.data.config.model}
								onChange={(model) => patchConfig({ model })}
								backend={backendOf(selected.data.config.model)}
								started={false}
							/>
							<ModeMenu
								value={selected.data.config.permissionMode}
								onChange={(permissionMode) => patchConfig({ permissionMode })}
							/>
							<EffortMenu
								value={selected.data.config.effort}
								onChange={(effort) => patchConfig({ effort })}
							/>
						</div>
						<div className="space-y-1">
							<span className="text-[11px] font-medium text-muted-foreground">
								Task
							</span>
							<textarea
								value={selected.data.config.prompt}
								onChange={(e) => patchConfig({ prompt: e.target.value })}
								rows={5}
								placeholder="What should this agent do?"
								className="w-full resize-none rounded-md border border-border/60 bg-transparent px-2.5 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground/60 focus-visible:border-border"
							/>
						</div>
						<label className="flex items-center justify-between gap-2 text-[13px]">
							<span>Writes code</span>
							<Switch
								checked={selected.data.config.writesCode}
								onCheckedChange={(writesCode) => patchConfig({ writesCode })}
							/>
						</label>
						{selected.data.config.writesCode ? (
							<div className="space-y-1">
								<span className="text-[11px] font-medium text-muted-foreground">
									Branch
								</span>
								<Input
									value={selected.data.config.branchHint ?? ""}
									onChange={(e) =>
										patchConfig({ branchHint: e.target.value || null })
									}
									placeholder="feat/my-feature"
									className="h-8 font-mono text-[12px]"
								/>
							</div>
						) : null}
					</aside>
				) : null}
			</div>
		</div>
	);
}

export function WorkflowEditor({ workflowId }: { workflowId: string }) {
	const workflow = useAppStore((s) => s.workflows[workflowId]);
	if (!workflow) return null;
	return (
		<ReactFlowProvider>
			<Canvas workflow={workflow} />
		</ReactFlowProvider>
	);
}
