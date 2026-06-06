import {
	Handle,
	type NodeProps,
	Position,
	useReactFlow,
} from "@xyflow/react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";

import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { baseModelId, MODELS } from "@/lib/models";
import { PROVIDER_ICON } from "@/lib/provider-icons";
import { cn } from "@/lib/utils";
import { INTENT_META } from "@/lib/workflow-intents";
import { useAppStore } from "@/store/app-store";
import type { Backend } from "@/types";
import type { AgentTaskConfig, NodeRunStatus } from "@/types/workflow";

export interface AgentNodeData {
	label: string;
	config: AgentTaskConfig;
	[key: string]: unknown;
}

function backendOf(model: string): Backend {
	const id = model.toLowerCase();
	return id.startsWith("gpt") || id.startsWith("codex") ? "codex" : "claude";
}

const STATUS_BAR: Record<NodeRunStatus, string> = {
	pending: "bg-transparent",
	running: "bg-blue-500",
	done: "bg-emerald-500",
	failed: "bg-red-500",
	skipped: "bg-muted-foreground/30",
	paused: "bg-amber-500",
	awaitingInput: "bg-amber-500",
};

const STATUS_DOT: Record<NodeRunStatus, string> = {
	pending: "bg-muted-foreground/30",
	running: "bg-blue-500",
	done: "bg-emerald-500",
	failed: "bg-red-500",
	skipped: "bg-muted-foreground/30",
	paused: "bg-amber-500",
	awaitingInput: "bg-amber-500",
};

export function AgentNode({ id, data, selected }: NodeProps) {
	const node = data as AgentNodeData;
	const { deleteElements } = useReactFlow();
	const status = useAppStore(
		(s) => s.workflowRun?.nodes.find((n) => n.nodeId === id)?.status,
	);
	const cfg = node.config;
	const meta = INTENT_META[cfg.intent];
	const Icon = meta.icon;
	const ProviderIcon = PROVIDER_ICON[backendOf(cfg.model)];
	const model =
		MODELS.find((m) => m.id === baseModelId(cfg.model))?.label ?? cfg.model;

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					className={cn(
						"relative w-56 overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm transition",
						selected && "ring-2 ring-primary/60",
					)}
				>
					<div
						className={cn(
							"absolute inset-y-0 left-0 w-1",
							status ? STATUS_BAR[status] : "bg-transparent",
						)}
					/>
					<Handle
						type="target"
						position={Position.Top}
						className="!size-2 !border-border !bg-muted-foreground"
					/>
					<div className="flex items-center gap-2.5 py-2.5 pr-3 pl-3.5">
						<div
							className={cn(
								"flex size-8 shrink-0 items-center justify-center rounded-lg",
								meta.tile,
							)}
						>
							<Icon className={cn("size-4", meta.accent)} />
						</div>
						<div className="min-w-0 flex-1">
							<div className="truncate text-[13px] font-medium text-foreground">
								{node.label || meta.label}
							</div>
							<div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
								<ProviderIcon className="size-3 shrink-0" />
								<span className="truncate">{model}</span>
							</div>
						</div>
						{status === "running" ? (
							<Loader2 className="size-3.5 shrink-0 animate-spin text-blue-500" />
						) : status === "awaitingInput" ? (
							<AlertTriangle
								className="size-3.5 shrink-0 text-amber-500"
								aria-label="Waiting for your answer"
							/>
						) : status && status !== "pending" ? (
							<span
								className={cn(
									"size-2 shrink-0 rounded-full",
									STATUS_DOT[status],
								)}
							/>
						) : null}
					</div>
					<Handle
						type="source"
						position={Position.Bottom}
						className="!size-2 !border-border !bg-muted-foreground"
					/>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent className="w-40">
				<ContextMenuItem
					variant="destructive"
					onSelect={() => void deleteElements({ nodes: [{ id }] })}
				>
					<Trash2 className="size-3.5" />
					Delete node
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
