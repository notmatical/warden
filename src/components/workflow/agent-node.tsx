import { Handle, type NodeProps, Position } from "@xyflow/react";

import { PROVIDER_ICON } from "@/lib/provider-icons";
import { cn } from "@/lib/utils";
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

const STATUS_RING: Record<NodeRunStatus, string> = {
	pending: "border-border/60",
	running: "border-blue-500/70 shadow-[0_0_0_1px] shadow-blue-500/40",
	done: "border-emerald-500/70",
	failed: "border-red-500/70",
	skipped: "border-border/40",
};

const STATUS_DOT: Record<NodeRunStatus, string> = {
	pending: "bg-muted-foreground/40",
	running: "bg-blue-500 animate-pulse",
	done: "bg-emerald-500",
	failed: "bg-red-500",
	skipped: "bg-muted-foreground/30",
};

export function AgentNode({ id, data, selected }: NodeProps) {
	const node = data as AgentNodeData;
	const status = useAppStore(
		(s) => s.workflowRun?.nodes.find((n) => n.nodeId === id)?.status,
	);
	const cfg = node.config;
	const Icon = PROVIDER_ICON[backendOf(cfg.model)];

	return (
		<div
			className={cn(
				"w-52 rounded-xl border-2 bg-card px-3 py-2.5 shadow-sm transition",
				status ? STATUS_RING[status] : "border-border/60",
				selected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
			)}
		>
			<Handle
				type="target"
				position={Position.Top}
				className="!size-2 !border-border !bg-muted-foreground"
			/>
			<div className="flex items-center gap-2">
				<Icon className="size-4 shrink-0" />
				<span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
					{node.label || "Agent"}
				</span>
				<span
					className={cn(
						"size-2 shrink-0 rounded-full",
						status ? STATUS_DOT[status] : "bg-muted-foreground/30",
					)}
				/>
			</div>
			<div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
				<span className="truncate font-mono">{cfg.model}</span>
			</div>
			<div className="mt-1 flex flex-wrap gap-1">
				<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
					{cfg.permissionMode}
				</span>
				{cfg.writesCode ? (
					<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
						{cfg.branchHint || "feature branch"}
					</span>
				) : null}
			</div>
			<Handle
				type="source"
				position={Position.Bottom}
				className="!size-2 !border-border !bg-muted-foreground"
			/>
		</div>
	);
}
