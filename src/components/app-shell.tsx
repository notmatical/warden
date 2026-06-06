import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	PointerSensor,
	pointerWithin,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { type CSSProperties, useCallback, useEffect } from "react";

import { DragPreview } from "@/components/drag-preview";
import { EmptyState } from "@/components/empty-state";
import { PaneGrid } from "@/components/pane-grid";
import { SessionTabs } from "@/components/session-tabs";
import { Sidebar } from "@/components/sidebar";
import { SidebarResizer } from "@/components/sidebar-resizer";
import { Topbar } from "@/components/topbar";
import { WorkflowEditor } from "@/components/workflow/workflow-editor";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppStore } from "@/store/app-store";
import type { SplitSide } from "@/types";

export function AppShell() {
	const init = useAppStore((s) => s.init);
	const hasGroup = useAppStore((s) => s.activeGroupId !== null);
	const hasRoots = useAppStore((s) =>
		s.activeGroupId
			? (s.rootsByGroup[s.activeGroupId]?.length ?? 0) > 0
			: false,
	);
	const hasTabs = useAppStore((s) => s.openTabs.length > 0);
	const activeWorkflowId = useAppStore((s) => s.activeWorkflowId);
	const layout = useAppStore((s) => s.layout);
	const draggingSessionId = useAppStore((s) => s.draggingSessionId);
	const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
	const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
	const sidebarWidth = useAppStore((s) => s.sidebarWidth);

	const onOpenChange = useCallback(
		(open: boolean) => setSidebarCollapsed(!open),
		[setSidebarCollapsed],
	);

	useEffect(() => {
		void init();
	}, [init]);

	// A small activation distance lets a plain click still select the tab while a
	// deliberate drag assigns it to a pane.
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
	);

	const onDragStart = useCallback((event: DragStartEvent) => {
		const sessionId = event.active.data.current?.sessionId as
			| string
			| undefined;
		useAppStore.getState().setDragging(sessionId ?? null);
	}, []);

	const onDragEnd = useCallback((event: DragEndEvent) => {
		useAppStore.getState().setDragging(null);
		const sessionId = event.active.data.current?.sessionId as
			| string
			| undefined;
		const data = event.over?.data.current as
			| { type?: "tab"; sessionId?: string; leafId?: string; side?: SplitSide }
			| undefined;
		if (!sessionId || !data) return;
		const store = useAppStore.getState();
		// Dropped on a tab → reorder the strip; on a pane → compose the viewport.
		if (data.type === "tab" && data.sessionId) {
			store.reorderTab(sessionId, data.sessionId);
		} else if (data.leafId) {
			if (!data.side || data.side === "center") {
				store.assignToPane(data.leafId, sessionId);
			} else {
				store.splitPane(data.leafId, data.side, sessionId);
			}
		}
	}, []);

	const onDragCancel = useCallback(() => {
		useAppStore.getState().setDragging(null);
	}, []);

	return (
		<TooltipProvider>
			<DndContext
				sensors={sensors}
				collisionDetection={pointerWithin}
				onDragStart={onDragStart}
				onDragEnd={onDragEnd}
				onDragCancel={onDragCancel}
			>
				<SidebarProvider
					open={!sidebarCollapsed}
					onOpenChange={onOpenChange}
					style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
					className="relative h-svh min-h-0 overflow-hidden bg-background text-foreground"
				>
					<Sidebar />
					{sidebarCollapsed ? null : <SidebarResizer />}
					<SidebarInset className="min-w-0">
						<Topbar />
						<SessionTabs />
						<main className="min-h-0 flex-1">
							{activeWorkflowId ? (
								<WorkflowEditor workflowId={activeWorkflowId} />
							) : !hasGroup ? (
								<EmptyState variant="no-project" />
							) : !hasRoots ? (
								<EmptyState variant="no-root" />
							) : hasTabs && layout ? (
								<PaneGrid layout={layout} />
							) : (
								<EmptyState variant="no-session" />
							)}
						</main>
					</SidebarInset>
				</SidebarProvider>
				<DragOverlay dropAnimation={null}>
					{draggingSessionId ? (
						<DragPreview sessionId={draggingSessionId} />
					) : null}
				</DragOverlay>
			</DndContext>
		</TooltipProvider>
	);
}
