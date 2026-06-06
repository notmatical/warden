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
import {
	ArrowLeft,
	Copy,
	ExternalLink,
	MoreHorizontal,
	Pencil,
	Play,
	Plus,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { EffortMenu } from "@/components/controls/effort-menu";
import { ModeMenu } from "@/components/controls/mode-menu";
import { ModelMenu } from "@/components/controls/model-menu";
import { Transcript } from "@/components/transcript";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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
	const nodeRuns = useAppStore((s) => s.workflowRun?.nodes);
	const loadEvents = useAppStore((s) => s.loadEvents);
	const openSession = useAppStore((s) => s.openSession);
	const renameWorkflow = useAppStore((s) => s.renameWorkflow);
	const duplicateWorkflow = useAppStore((s) => s.duplicateWorkflow);
	const deleteWorkflow = useAppStore((s) => s.deleteWorkflow);
	const openWorkflow = useAppStore((s) => s.openWorkflow);

	const openNodeSession = (sessionId: string | null | undefined) => {
		if (!sessionId) return;
		openSession(sessionId);
		closeWorkflow();
	};

	const [renaming, setRenaming] = useState(false);
	const [nameDraft, setNameDraft] = useState(workflow.name);
	const commitRename = () => {
		const name = nameDraft.trim();
		if (name && name !== workflow.name) void renameWorkflow(workflow.id, name);
		setRenaming(false);
	};

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
	const [panelTab, setPanelTab] = useState<"config" | "output">("config");
	const nodeSessionId = selected
		? (nodeRuns?.find((n) => n.nodeId === selected.id)?.sessionId ?? null)
		: null;
	useEffect(() => {
		if (panelTab === "output" && nodeSessionId) void loadEvents(nodeSessionId);
	}, [panelTab, nodeSessionId, loadEvents]);

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
				{renaming ? (
					<input
						value={nameDraft}
						onChange={(e) => setNameDraft(e.target.value)}
						onBlur={commitRename}
						onKeyDown={(e) => {
							if (e.key === "Enter") commitRename();
							if (e.key === "Escape") setRenaming(false);
						}}
						className="h-7 w-56 rounded-md border border-border bg-transparent px-2 text-sm font-medium outline-none"
					/>
				) : (
					<button
						type="button"
						onDoubleClick={() => {
							setNameDraft(workflow.name);
							setRenaming(true);
						}}
						className="rounded px-1 text-sm font-medium hover:bg-muted"
						title="Double-click to rename"
					>
						{workflow.name}
					</button>
				)}
				{runStatus ? (
					<span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground tabular-nums">
						{runStatus}
					</span>
				) : null}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Workflow actions"
							className="text-muted-foreground hover:text-foreground"
						>
							<MoreHorizontal className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="w-44">
						<DropdownMenuItem
							onSelect={() => {
								setNameDraft(workflow.name);
								setRenaming(true);
							}}
						>
							<Pencil className="size-3.5" />
							Rename
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() =>
								void duplicateWorkflow(workflow.id).then(
									(c) => c && openWorkflow(c.id),
								)
							}
						>
							<Copy className="size-3.5" />
							Duplicate
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							variant="destructive"
							onSelect={() => void deleteWorkflow(workflow.id)}
						>
							<Trash2 className="size-3.5" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
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
						onNodeDoubleClick={(_, n) =>
							openNodeSession(
								nodeRuns?.find((r) => r.nodeId === n.id)?.sessionId,
							)
						}
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
					<aside className="flex w-96 shrink-0 flex-col border-l border-border/60">
						<div className="flex shrink-0 items-center gap-1 border-b border-border/60 p-1.5">
							<button
								type="button"
								onClick={() => setPanelTab("config")}
								className={cn(
									"flex-1 rounded-md px-2 py-1 text-xs font-medium transition",
									panelTab === "config"
										? "bg-muted text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								Config
							</button>
							<button
								type="button"
								onClick={() => setPanelTab("output")}
								disabled={!nodeSessionId}
								className={cn(
									"flex-1 rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-40",
									panelTab === "output"
										? "bg-muted text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								Output
							</button>
						</div>
						{panelTab === "config" ? (
							<div className="space-y-3 overflow-auto p-3">
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
						{selected.data.config.permissionMode === "plan" ? (
							<p className="rounded-md bg-muted/50 px-2.5 py-2 text-[11px] text-muted-foreground">
								Plan mode is read-only — this node researches and hands its
								plan to the next node.
							</p>
						) : (
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
								<p className="text-[10px] text-muted-foreground/70">
									Edits run on this branch in an isolated worktree.
								</p>
							</div>
						)}
							</div>
						) : nodeSessionId ? (
							<div className="flex min-h-0 flex-1 flex-col">
								<div className="flex shrink-0 justify-end border-b border-border/60 px-2 py-1.5">
									<Button
										variant="ghost"
										size="xs"
										onClick={() => openNodeSession(nodeSessionId)}
										className="gap-1.5 text-muted-foreground hover:text-foreground"
									>
										<ExternalLink className="size-3.5" />
										Open full session
									</Button>
								</div>
								<div className="relative min-h-0 flex-1">
									<Transcript sessionId={nodeSessionId} bottomInset={0} />
								</div>
							</div>
						) : (
							<p className="p-6 text-center text-xs text-muted-foreground">
								Run the workflow to see this node's output.
							</p>
						)}
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
