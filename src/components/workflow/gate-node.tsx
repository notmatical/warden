import {
	Handle,
	type NodeProps,
	Position,
	useReactFlow,
} from "@xyflow/react";
import { Check, ShieldQuestion, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";

export interface GateNodeData {
	label: string;
	prompt?: string | null;
	[key: string]: unknown;
}

export function GateNode({ id, data, selected }: NodeProps) {
	const node = data as GateNodeData;
	const { deleteElements } = useReactFlow();
	const status = useAppStore(
		(s) => s.workflowRun?.nodes.find((n) => n.nodeId === id)?.status,
	);
	const resumeRun = useAppStore((s) => s.resumeRun);
	const paused = status === "paused";

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					className={cn(
						"w-56 overflow-hidden rounded-xl border-2 border-dashed bg-card shadow-sm transition",
						paused
							? "border-amber-500/70"
							: status === "done"
								? "border-emerald-500/40"
								: "border-border/70",
						selected && "ring-2 ring-primary/60",
					)}
				>
					<Handle
						type="target"
						position={Position.Top}
						className="!size-2 !border-border !bg-muted-foreground"
					/>
					<div className="flex items-center gap-2.5 px-3 py-2.5">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/12">
							<ShieldQuestion className="size-4 text-amber-500" />
						</div>
						<div className="min-w-0 flex-1">
							<div className="truncate text-[13px] font-medium text-foreground">
								{node.label || "Approval gate"}
							</div>
							<div className="mt-0.5 truncate text-[11px] text-muted-foreground">
								{paused ? "Awaiting your approval" : "Pauses for approval"}
							</div>
						</div>
					</div>
					{paused ? (
						<div className="nodrag flex gap-1.5 px-3 pb-2.5">
							<Button
								size="xs"
								onClick={() => void resumeRun(true)}
								className="flex-1 gap-1 bg-emerald-600 text-white hover:bg-emerald-600/90"
							>
								<Check className="size-3" />
								Approve
							</Button>
							<Button
								size="xs"
								variant="ghost"
								onClick={() => void resumeRun(false)}
								className="flex-1 gap-1 text-red-500 hover:bg-red-500/10 hover:text-red-500"
							>
								<X className="size-3" />
								Reject
							</Button>
						</div>
					) : null}
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
