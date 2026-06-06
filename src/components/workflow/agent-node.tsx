import {
	Handle,
	type NodeProps,
	Position,
	useReactFlow,
} from "@xyflow/react";
import { Loader2, Trash2 } from "lucide-react";

import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { baseModelId, MODELS } from "@/lib/models";
import { PROVIDER_ICON } from "@/lib/provider-icons";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { Backend, PermissionMode } from "@/types";
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

const MODE_LABEL: Record<PermissionMode, string> = {
	plan: "Plan",
	acceptEdits: "Edit",
	bypassPermissions: "Auto",
	default: "Ask",
};

const STATUS_BAR: Record<NodeRunStatus, string> = {
	pending: "bg-transparent",
	running: "bg-blue-500",
	done: "bg-emerald-500",
	failed: "bg-red-500",
	skipped: "bg-muted-foreground/30",
};

const STATUS_DOT: Record<NodeRunStatus, string> = {
	pending: "bg-muted-foreground/30",
	running: "bg-blue-500",
	done: "bg-emerald-500",
	failed: "bg-red-500",
	skipped: "bg-muted-foreground/30",
};

export function AgentNode({ id, data, selected }: NodeProps) {
	const node = data as AgentNodeData;
	const { deleteElements } = useReactFlow();
	const status = useAppStore(
		(s) => s.workflowRun?.nodes.find((n) => n.nodeId === id)?.status,
	);
	const cfg = node.config;
	const Icon = PROVIDER_ICON[backendOf(cfg.model)];
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
						<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
							<Icon className="size-4" />
						</div>
						<div className="min-w-0 flex-1">
							<div className="truncate text-[13px] font-medium text-foreground">
								{node.label || "Agent"}
							</div>
							<div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
								<span className="truncate">{model}</span>
								<span className="text-muted-foreground/40">·</span>
								<span className="shrink-0">{MODE_LABEL[cfg.permissionMode]}</span>
							</div>
						</div>
						{status === "running" ? (
							<Loader2 className="size-3.5 shrink-0 animate-spin text-blue-500" />
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
