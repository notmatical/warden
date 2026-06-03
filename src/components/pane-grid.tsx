import { useDroppable } from "@dnd-kit/core";
import { LayoutGrid, X } from "lucide-react";
import { memo } from "react";

import { SessionView } from "@/components/session-view";
import { StatusDot } from "@/components/status-dot";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { PANE_COUNT } from "@/lib/layout";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { Layout } from "@/types";

function PaneHeader({ sessionId }: { sessionId: string }) {
	const title = useAppStore((s) => s.sessions[sessionId]?.title);
	const status = useAppStore((s) => s.sessions[sessionId]?.status);
	const closeTab = useAppStore((s) => s.closeTab);
	if (title === undefined || status === undefined) {
		return null;
	}
	return (
		<div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 px-2.5 text-xs">
			<StatusDot status={status} />
			<span
				className="min-w-0 flex-1 truncate text-muted-foreground"
				title={title}
			>
				{title}
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

function Pane({
	index,
	sessionId,
	active,
}: {
	index: number;
	sessionId: string | null;
	active: boolean;
}) {
	const { setNodeRef, isOver } = useDroppable({
		id: `pane:${index}`,
		data: { paneIndex: index },
	});
	const selectSession = useAppStore((s) => s.selectSession);

	return (
		<div
			ref={setNodeRef}
			onMouseDownCapture={() => {
				if (sessionId) selectSession(sessionId);
			}}
			className={cn(
				"group/pane relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background transition-colors",
				isOver ? "bg-muted/40" : null,
			)}
		>
			{sessionId ? (
				<>
					{active ? (
						<span className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-ring/70" />
					) : null}
					<PaneHeader sessionId={sessionId} />
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
		</div>
	);
}

const MemoPane = memo(Pane);

export function PaneGrid({ layout }: { layout: Layout }) {
	const activeGroupId = useAppStore((s) => s.activeGroupId);
	const activeSessionId = useAppStore((s) =>
		s.activeGroupId ? (s.activeSessionByGroup[s.activeGroupId] ?? null) : null,
	);

	// Single mode is the classic tabbed view: the lone pane follows the active
	// session. Multi-pane modes render their explicit assignments.
	const cells: (string | null)[] =
		layout.mode === "single"
			? [activeSessionId]
			: Array.from(
					{ length: PANE_COUNT[layout.mode] },
					(_, i) => layout.panes[i] ?? null,
				);

	const cell = (i: number) => (
		<MemoPane
			index={i}
			sessionId={cells[i]}
			active={cells[i] !== null && cells[i] === activeSessionId}
		/>
	);

	// Stable identity per group + mode + sub-group so each layout keeps its own
	// pane sizes while mounted.
	const gid = (suffix: string) =>
		`warden:panes:${activeGroupId ?? "none"}:${layout.mode}:${suffix}`;

	// Single pane is a bare, full-bleed session — no pane chrome, no padding.
	if (layout.mode === "single") {
		return activeSessionId ? (
			<SessionView key={activeSessionId} sessionId={activeSessionId} />
		) : null;
	}

	if (layout.mode === "cols-2" || layout.mode === "rows-2") {
		const orientation = layout.mode === "cols-2" ? "horizontal" : "vertical";
		return (
			<ResizablePanelGroup orientation={orientation} id={gid("root")}>
				<ResizablePanel id="a" defaultSize={50} minSize={20}>
					{cell(0)}
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel id="b" defaultSize={50} minSize={20}>
					{cell(1)}
				</ResizablePanel>
			</ResizablePanelGroup>
		);
	}

	if (layout.mode === "three") {
		return (
			<ResizablePanelGroup orientation="vertical" id={gid("root")}>
				<ResizablePanel id="top" defaultSize={60} minSize={20}>
					<ResizablePanelGroup orientation="horizontal" id={gid("top")}>
						<ResizablePanel id="a" defaultSize={50} minSize={20}>
							{cell(0)}
						</ResizablePanel>
						<ResizableHandle />
						<ResizablePanel id="b" defaultSize={50} minSize={20}>
							{cell(1)}
						</ResizablePanel>
					</ResizablePanelGroup>
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel id="bottom" defaultSize={40} minSize={20}>
					{cell(2)}
				</ResizablePanel>
			</ResizablePanelGroup>
		);
	}

	// grid-4
	return (
		<ResizablePanelGroup orientation="vertical" id={gid("root")}>
			<ResizablePanel id="top" defaultSize={50} minSize={20}>
				<ResizablePanelGroup orientation="horizontal" id={gid("top")}>
					<ResizablePanel id="a" defaultSize={50} minSize={20}>
						{cell(0)}
					</ResizablePanel>
					<ResizableHandle />
					<ResizablePanel id="b" defaultSize={50} minSize={20}>
						{cell(1)}
					</ResizablePanel>
				</ResizablePanelGroup>
			</ResizablePanel>
			<ResizableHandle />
			<ResizablePanel id="bottom" defaultSize={50} minSize={20}>
				<ResizablePanelGroup orientation="horizontal" id={gid("bottom")}>
					<ResizablePanel id="c" defaultSize={50} minSize={20}>
						{cell(2)}
					</ResizablePanel>
					<ResizableHandle />
					<ResizablePanel id="d" defaultSize={50} minSize={20}>
						{cell(3)}
					</ResizablePanel>
				</ResizablePanelGroup>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
