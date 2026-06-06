import { useDroppable } from "@dnd-kit/core";
import {
	LayoutGrid,
	Settings2,
	Workflow as WorkflowIcon,
	X,
} from "lucide-react";
import { Fragment, memo, type ReactNode, useEffect, useState } from "react";

import { SessionView } from "@/components/session-view";
import { StatusDot } from "@/components/status-dot";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { leafCount } from "@/lib/pane-tree";
import { isSettingsTab, isWorkflowTab, workflowIdOf } from "@/lib/tab-ref";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { Leaf, PaneTree, SplitSide } from "@/types";

function PaneHeader({
	sessionId,
	active,
}: {
	sessionId: string;
	active: boolean;
}) {
	const workflow = isWorkflowTab(sessionId);
	const settings = isSettingsTab(sessionId);
	const isStatic = workflow || settings;
	const title = useAppStore((s) =>
		isStatic ? undefined : s.sessions[sessionId]?.title,
	);
	const status = useAppStore((s) =>
		isStatic ? undefined : s.sessions[sessionId]?.status,
	);
	const wfName = useAppStore((s) =>
		workflow ? s.workflows[workflowIdOf(sessionId)]?.name : undefined,
	);
	const closeTab = useAppStore((s) => s.closeTab);
	if (!isStatic && (title === undefined || status === undefined)) {
		return null;
	}
	const staticIcon = settings ? Settings2 : WorkflowIcon;
	const StaticIcon = staticIcon;
	const staticLabel = settings ? "Settings" : (wfName ?? "Workflow");
	return (
		<div
			className={cn(
				"flex h-8 shrink-0 items-center gap-2 px-2.5 text-xs transition-colors",
				active ? "bg-muted/30" : null,
			)}
		>
			{isStatic ? (
				<StaticIcon className="size-3.5 shrink-0 text-muted-foreground" />
			) : (
				<StatusDot status={status as NonNullable<typeof status>} />
			)}
			<span
				className={cn(
					"min-w-0 flex-1 truncate transition-colors",
					active ? "text-foreground" : "text-muted-foreground/55",
				)}
				title={isStatic ? staticLabel : title}
			>
				{isStatic ? staticLabel : title}
			</span>
			<button
				type="button"
				aria-label="Close tab"
				onClick={() => closeTab(sessionId)}
				className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition group-hover/pane:opacity-100 hover:bg-muted hover:text-foreground"
			>
				<X className="size-3.5" />
			</button>
		</div>
	);
}

// Each side maps to the half of the pane the dropped session will occupy.
const HALF: Record<SplitSide, string> = {
	left: "inset-y-0 left-0 w-1/2",
	right: "inset-y-0 right-0 w-1/2",
	top: "inset-x-0 top-0 h-1/2",
	bottom: "inset-x-0 bottom-0 h-1/2",
	center: "inset-0",
};

function DropZone({
	leafId,
	side,
	className,
	onOver,
}: {
	leafId: string;
	side: SplitSide;
	className: string;
	onOver: (side: SplitSide) => void;
}) {
	const { setNodeRef, isOver } = useDroppable({
		id: `zone:${leafId}:${side}`,
		data: { leafId, side },
	});
	useEffect(() => {
		if (isOver) onOver(side);
	}, [isOver, side, onOver]);
	return <div ref={setNodeRef} className={cn("absolute", className)} />;
}

/** While a drag is in flight, tile the pane with five drop targets: four edges
 *  that split it and a center that swaps its session. An empty pane only offers
 *  the center (filling it). */
function DropZones({
	leafId,
	edges,
	onOver,
}: {
	leafId: string;
	edges: boolean;
	onOver: (side: SplitSide) => void;
}) {
	if (!edges) {
		return (
			<div className="absolute inset-0 z-20">
				<DropZone
					leafId={leafId}
					side="center"
					className="inset-0"
					onOver={onOver}
				/>
			</div>
		);
	}
	return (
		<div className="absolute inset-0 z-20">
			<DropZone
				leafId={leafId}
				side="left"
				className="top-0 bottom-0 left-0 w-1/4"
				onOver={onOver}
			/>
			<DropZone
				leafId={leafId}
				side="right"
				className="top-0 right-0 bottom-0 w-1/4"
				onOver={onOver}
			/>
			<DropZone
				leafId={leafId}
				side="top"
				className="top-0 left-1/4 h-1/3 w-1/2"
				onOver={onOver}
			/>
			<DropZone
				leafId={leafId}
				side="bottom"
				className="bottom-0 left-1/4 h-1/3 w-1/2"
				onOver={onOver}
			/>
			<DropZone
				leafId={leafId}
				side="center"
				className="top-1/3 bottom-1/3 left-1/4 w-1/2"
				onOver={onOver}
			/>
		</div>
	);
}

/** A single pane: shows its leaf's session (header only in multi-pane layouts —
 *  a lone pane is chromeless since the tab strip already labels it), or an empty
 *  drop zone. While dragging, it surfaces edge/center split targets. */
function Pane({ leaf, chrome }: { leaf: Leaf; chrome: boolean }) {
	const sessionId = leaf.sessionId;
	const dragging = useAppStore((s) => s.draggingSessionId !== null);
	const active = useAppStore(
		(s) => sessionId !== null && s.activeSessionId === sessionId,
	);
	const selectSession = useAppStore((s) => s.selectSession);
	const [overSide, setOverSide] = useState<SplitSide | null>(null);

	return (
		<div
			onMouseDownCapture={() => {
				if (sessionId) selectSession(sessionId);
			}}
			className="group/pane relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
		>
			{sessionId ? (
				<>
					{chrome ? (
						<PaneHeader sessionId={sessionId} active={active} />
					) : null}
					<div className="relative min-h-0 flex-1">
						<SessionView key={sessionId} sessionId={sessionId} />
					</div>
				</>
			) : (
				<div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground/60">
					<LayoutGrid className="size-5" />
					<p className="text-xs">Drop a tab here</p>
				</div>
			)}
			{dragging ? (
				<DropZones
					leafId={leaf.id}
					edges={sessionId !== null}
					onOver={setOverSide}
				/>
			) : null}
			{dragging && overSide ? (
				<div
					className={cn(
						"pointer-events-none absolute z-30 rounded-sm bg-ring/25 ring-1 ring-ring/60 ring-inset transition-all",
						HALF[overSide],
					)}
				/>
			) : null}
		</div>
	);
}

const MemoPane = memo(Pane);

/** Render a tree node: a leaf becomes a pane; a split becomes a nested resizable
 *  group. Keyed by child ids so a structural change (split/collapse) remounts the
 *  group cleanly with its new default sizes. */
function renderNode(node: PaneTree, chrome: boolean): ReactNode {
	if (node.type === "leaf") {
		return <MemoPane leaf={node} chrome={chrome} />;
	}
	const orientation = node.dir === "row" ? "horizontal" : "vertical";
	return (
		<ResizablePanelGroup
			key={node.children.map((c) => c.id).join(",")}
			orientation={orientation}
			id={node.id}
		>
			{node.children.map((child, i) => (
				<Fragment key={child.id}>
					{i > 0 ? <ResizableHandle /> : null}
					<ResizablePanel id={child.id} defaultSize={node.sizes[i]} minSize={10}>
						{renderNode(child, chrome)}
					</ResizablePanel>
				</Fragment>
			))}
		</ResizablePanelGroup>
	);
}

export function PaneGrid({ layout }: { layout: PaneTree }) {
	// A lone pane is full-bleed; only multi-pane layouts get per-pane chrome.
	return renderNode(layout, leafCount(layout) > 1);
}
