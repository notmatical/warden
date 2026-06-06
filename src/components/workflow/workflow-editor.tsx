import "@xyflow/react/dist/style.css";
import "@/styles/workflow.css";

import {
	addEdge,
	Background,
	type Connection,
	Controls,
	type Edge,
	type Node,
	type OnConnectEnd,
	type OnConnectStart,
	ReactFlow,
	ReactFlowProvider,
	useEdgesState,
	useNodesState,
	useReactFlow,
} from "@xyflow/react";
import {
	Copy,
	ExternalLink,
	MoreHorizontal,
	Pencil,
	Play,
	Plus,
	ShieldQuestion,
	Trash2,
} from "lucide-react";
import {
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

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
import { INTENT_META, INTENT_ORDER } from "@/lib/workflow-intents";
import { useAppStore } from "@/store/app-store";
import type { Backend } from "@/types";
import type {
	AgentTaskConfig,
	Intent,
	NodeKind,
	Workflow,
	WorkflowGraph,
} from "@/types/workflow";

import { AgentNode, type AgentNodeData } from "./agent-node";
import { GateNode, type GateNodeData } from "./gate-node";

const nodeTypes = { agent: AgentNode, gate: GateNode };

function backendOf(model: string): Backend {
	const id = model.toLowerCase();
	return id.startsWith("gpt") || id.startsWith("codex") ? "codex" : "claude";
}

const DEFAULT_MODEL = "claude-opus-4-8";

function defaultConfig(intent: Intent): AgentTaskConfig {
	return {
		intent,
		model: DEFAULT_MODEL,
		effort: "high",
		prompt: "",
		branchHint: null,
		permissionMode: null,
	};
}

type AgentKind = Extract<NodeKind, { type: "agentTask" }>;

function configFromKind(kind: AgentKind): AgentTaskConfig {
	return {
		intent: kind.intent,
		model: kind.model,
		effort: kind.effort,
		prompt: kind.prompt,
		branchHint: kind.branchHint ?? null,
		permissionMode: kind.permissionMode ?? null,
	};
}

function toRF(graph: WorkflowGraph): { nodes: Node[]; edges: Edge[] } {
	const nodes: Node[] = [];
	graph.nodes.forEach((n, i) => {
		const position = n.position ?? { x: 140, y: 80 + i * 150 };
		if (n.kind.type === "gate") {
			nodes.push({
				id: n.id,
				type: "gate",
				position,
				data: { label: n.label, prompt: n.kind.prompt ?? null },
			});
		} else if (n.kind.type === "agentTask") {
			nodes.push({
				id: n.id,
				type: "agent",
				position,
				data: { label: n.label, config: configFromKind(n.kind) },
			});
		}
	});
	const edges: Edge[] = graph.edges.map((e) => ({
		id: e.id,
		source: e.source,
		target: e.target,
	}));
	return { nodes, edges };
}

function toGraph(nodes: Node[], edges: Edge[]): WorkflowGraph {
	return {
		nodes: nodes.map((n) => {
			if (n.type === "gate") {
				const d = n.data as GateNodeData;
				return {
					id: n.id,
					label: d.label,
					position: n.position,
					kind: { type: "gate", prompt: d.prompt ?? null },
				};
			}
			const d = n.data as AgentNodeData;
			return {
				id: n.id,
				label: d.label,
				position: n.position,
				kind: { type: "agentTask", ...d.config },
			};
		}),
		edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
	};
}

function Canvas({ workflow }: { workflow: Workflow }) {
	const saveWorkflowGraph = useAppStore((s) => s.saveWorkflowGraph);
	const runWorkflowById = useAppStore((s) => s.runWorkflowById);
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

	// Create a node (optionally at a position, optionally wired from a source).
	const createNode = (
		kind: Intent | "gate",
		position?: { x: number; y: number },
		connectFrom?: string,
	) => {
		const id = crypto.randomUUID();
		setNodes((ns) => {
			const pos = position ?? {
				x: 160 + ns.length * 24,
				y: 120 + ns.length * 24,
			};
			const node: Node =
				kind === "gate"
					? {
							id,
							type: "gate",
							position: pos,
							data: { label: "Approval", prompt: null },
						}
					: {
							id,
							type: "agent",
							position: pos,
							data: {
								label: INTENT_META[kind].label,
								config: defaultConfig(kind),
							},
						};
			return [...ns, node];
		});
		if (connectFrom) {
			setEdges((es) =>
				addEdge(
					{
						source: connectFrom,
						target: id,
						sourceHandle: null,
						targetHandle: null,
					},
					es,
				),
			);
		}
		setSelectedId(id);
	};

	// Drag a connection off into empty canvas → palette + auto-connect. Also
	// opened by right-clicking the canvas (no source).
	const { screenToFlowPosition } = useReactFlow();
	const connectingFrom = useRef<string | null>(null);
	const [palette, setPalette] = useState<{
		screen: { x: number; y: number };
		flow: { x: number; y: number };
		connectFrom?: string;
	} | null>(null);

	const openPaletteAt = (clientX: number, clientY: number, from?: string) => {
		setPalette({
			screen: { x: clientX, y: clientY },
			flow: screenToFlowPosition({ x: clientX, y: clientY }),
			connectFrom: from,
		});
	};

	const onConnectStart: OnConnectStart = (_e, params) => {
		connectingFrom.current = params.nodeId ?? null;
	};
	const onConnectEnd: OnConnectEnd = (event, state) => {
		const from = connectingFrom.current;
		connectingFrom.current = null;
		if (state.isValid || !from) return;
		const point = "clientX" in event ? event : event.changedTouches[0];
		openPaletteAt(point.clientX, point.clientY, from);
	};
	const onPaneContextMenu = (event: ReactMouseEvent | MouseEvent) => {
		event.preventDefault();
		openPaletteAt(event.clientX, event.clientY);
	};

	const selected = nodes.find((n) => n.id === selectedId) ?? null;
	const [panelTab, setPanelTab] = useState<"config" | "output">("config");
	const nodeSessionId = selected
		? (nodeRuns?.find((n) => n.nodeId === selected.id)?.sessionId ?? null)
		: null;
	useEffect(() => {
		if (panelTab === "output" && nodeSessionId) void loadEvents(nodeSessionId);
	}, [panelTab, nodeSessionId, loadEvents]);

	const patchData = (patch: Record<string, unknown>) =>
		setNodes((ns) =>
			ns.map((n) =>
				n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n,
			),
		);
	const patchConfig = (patch: Partial<AgentTaskConfig>) => {
		const cfg = (selected?.data as AgentNodeData | undefined)?.config;
		if (cfg) patchData({ config: { ...cfg, ...patch } });
	};

	const run = async () => {
		await saveWorkflowGraph(workflow.id, toGraph(nodes, edges));
		void runWorkflowById(workflow.id);
	};

	const running = runStatus === "running";

	return (
		<div className="flex h-full flex-col">
			<header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
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
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="sm" className="gap-1.5">
								<Plus className="size-3.5" />
								Add node
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-52">
							{INTENT_ORDER.map((intent) => {
								const meta = INTENT_META[intent];
								const Icon = meta.icon;
								return (
									<DropdownMenuItem
										key={intent}
										onSelect={() => createNode(intent)}
										className="gap-2"
									>
										<Icon className={cn("size-4", meta.accent)} />
										<span className="flex flex-col">
											<span className="text-[13px]">{meta.label}</span>
											<span className="text-[10px] text-muted-foreground">
												{meta.description}
											</span>
										</span>
									</DropdownMenuItem>
								);
							})}
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onSelect={() => createNode("gate")}
								className="gap-2"
							>
								<ShieldQuestion className="size-4 text-amber-500" />
								<span className="flex flex-col">
									<span className="text-[13px]">Approval gate</span>
									<span className="text-[10px] text-muted-foreground">
										Pause for your sign-off
									</span>
								</span>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button
						size="sm"
						onClick={() => void run()}
						disabled={nodes.length === 0 || running}
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
						onConnectStart={onConnectStart}
						onConnectEnd={onConnectEnd}
						onPaneContextMenu={onPaneContextMenu}
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
										value={selected.data.label as string}
										onChange={(e) => patchData({ label: e.target.value })}
										className="h-8 text-[13px]"
									/>
								</div>
								{selected.type === "gate" ? (
									<div className="space-y-1">
										<span className="text-[11px] font-medium text-muted-foreground">
											Approval prompt (optional)
										</span>
										<textarea
											value={(selected.data as GateNodeData).prompt ?? ""}
											onChange={(e) =>
												patchData({ prompt: e.target.value || null })
											}
											rows={3}
											placeholder="What should the reviewer check before approving?"
											className="w-full resize-none rounded-md border border-border/60 bg-transparent px-2.5 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground/60 focus-visible:border-border"
										/>
										<p className="text-[10px] text-muted-foreground/70">
											The run pauses here until you approve or reject.
										</p>
									</div>
								) : (
									<AgentConfig
										config={(selected.data as AgentNodeData).config}
										patchConfig={patchConfig}
									/>
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

			{palette ? (
				<NodePalette
					screen={palette.screen}
					onPick={(kind) => {
						createNode(kind, palette.flow, palette.connectFrom);
						setPalette(null);
					}}
					onClose={() => setPalette(null)}
				/>
			) : null}
		</div>
	);
}

/** A floating node palette anchored at a screen point (drag-release / right-click). */
function NodePalette({
	screen,
	onPick,
	onClose,
}: {
	screen: { x: number; y: number };
	onPick: (kind: Intent | "gate") => void;
	onClose: () => void;
}) {
	const entries: { kind: Intent | "gate" }[] = [
		...INTENT_ORDER.map((kind) => ({ kind })),
		{ kind: "gate" as const },
	];
	return (
		<>
			<button
				type="button"
				aria-label="Close"
				onClick={onClose}
				className="fixed inset-0 z-40 cursor-default"
			/>
			<div
				className="fixed z-50 w-52 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md"
				style={{
					left: Math.min(screen.x, window.innerWidth - 220),
					top: Math.min(screen.y, window.innerHeight - 280),
				}}
			>
				{entries.map(({ kind }) => {
					const meta =
						kind === "gate"
							? {
									icon: ShieldQuestion,
									label: "Approval gate",
									description: "Pause for your sign-off",
									accent: "text-amber-500",
								}
							: INTENT_META[kind];
					const Icon = meta.icon;
					return (
						<button
							type="button"
							key={kind}
							onClick={() => onPick(kind)}
							className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
						>
							<Icon className={cn("size-4 shrink-0", meta.accent)} />
							<span className="flex min-w-0 flex-col">
								<span className="text-[13px]">{meta.label}</span>
								<span className="truncate text-[10px] text-muted-foreground">
									{meta.description}
								</span>
							</span>
						</button>
					);
				})}
			</div>
		</>
	);
}

/** The intent-driven config for an agent node. */
function AgentConfig({
	config,
	patchConfig,
}: {
	config: AgentTaskConfig;
	patchConfig: (patch: Partial<AgentTaskConfig>) => void;
}) {
	const meta = INTENT_META[config.intent];
	const IntentIcon = meta.icon;
	return (
		<>
			<div className="space-y-1">
				<span className="text-[11px] font-medium text-muted-foreground">
					Does
				</span>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							className="flex w-full items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-left text-[13px] hover:bg-muted/40"
						>
							<IntentIcon className={cn("size-4", meta.accent)} />
							<span className="flex-1">{meta.label}</span>
							<span className="text-[10px] text-muted-foreground">
								{meta.description}
							</span>
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent className="w-56">
						{INTENT_ORDER.map((intent) => {
							const m = INTENT_META[intent];
							const Icon = m.icon;
							return (
								<DropdownMenuItem
									key={intent}
									onSelect={() => patchConfig({ intent })}
									className="gap-2"
								>
									<Icon className={cn("size-4", m.accent)} />
									{m.label}
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<div className="flex items-center gap-1.5">
				<ModelMenu
					value={config.model}
					onChange={(model) => patchConfig({ model })}
					backend={backendOf(config.model)}
					started={false}
				/>
				<EffortMenu
					value={config.effort}
					onChange={(effort) => patchConfig({ effort })}
				/>
				{config.intent === "custom" ? (
					<ModeMenu
						value={config.permissionMode ?? "bypassPermissions"}
						onChange={(permissionMode) => patchConfig({ permissionMode })}
					/>
				) : null}
			</div>

			<div className="space-y-1">
				<span className="text-[11px] font-medium text-muted-foreground">
					{meta.promptLabel}
				</span>
				<textarea
					value={config.prompt}
					onChange={(e) => patchConfig({ prompt: e.target.value })}
					rows={meta.promptRequired ? 5 : 3}
					placeholder={meta.promptPlaceholder}
					className="w-full resize-none rounded-md border border-border/60 bg-transparent px-2.5 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground/60 focus-visible:border-border"
				/>
			</div>

			{meta.writesCode ? (
				<div className="space-y-1">
					<span className="text-[11px] font-medium text-muted-foreground">
						Branch (optional)
					</span>
					<Input
						value={config.branchHint ?? ""}
						onChange={(e) =>
							patchConfig({ branchHint: e.target.value || null })
						}
						placeholder="defaults to the run's branch"
						className="h-8 font-mono text-[12px]"
					/>
				</div>
			) : (
				<p className="rounded-md bg-muted/50 px-2.5 py-2 text-[11px] text-muted-foreground">
					Read-only — researches and hands its result to the next node.
				</p>
			)}
		</>
	);
}

export function WorkflowEditor({ workflowId }: { workflowId: string }) {
	const workflow = useAppStore((s) => s.workflows[workflowId]);
	const ensureWorkflow = useAppStore((s) => s.ensureWorkflow);
	const loadWorkflowRun = useAppStore((s) => s.loadWorkflowRun);

	useEffect(() => {
		void ensureWorkflow(workflowId);
		void loadWorkflowRun(workflowId);
	}, [workflowId, ensureWorkflow, loadWorkflowRun]);

	if (!workflow) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Loading workflow…
			</div>
		);
	}
	return (
		<ReactFlowProvider>
			<Canvas key={workflow.id} workflow={workflow} />
		</ReactFlowProvider>
	);
}
