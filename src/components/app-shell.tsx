import {
	DndContext,
	type DragEndEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { type CSSProperties, useCallback, useEffect } from "react";

import { EmptyState } from "@/components/empty-state";
import { PaneGrid } from "@/components/pane-grid";
import { SessionTabs } from "@/components/session-tabs";
import { Sidebar } from "@/components/sidebar";
import { SidebarResizer } from "@/components/sidebar-resizer";
import { Topbar } from "@/components/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { assignPane } from "@/lib/layout";
import { useAppStore } from "@/store/app-store";

export function AppShell() {
	const init = useAppStore((s) => s.init);
	const hasGroup = useAppStore((s) => s.activeGroupId !== null);
	const hasRoots = useAppStore((s) =>
		s.activeGroupId
			? (s.rootsByGroup[s.activeGroupId]?.length ?? 0) > 0
			: false,
	);
	const hasTabs = useAppStore((s) =>
		s.activeGroupId ? (s.tabsByGroup[s.activeGroupId]?.length ?? 0) > 0 : false,
	);
	const layout = useAppStore((s) =>
		s.activeGroupId ? (s.layoutByGroup[s.activeGroupId] ?? null) : null,
	);
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

	// Keyboard shortcuts are registered centrally as commands; see lib/commands.ts
	// and the KeybindingProvider.

	// A small activation distance lets a plain click still select the tab while a
	// deliberate drag assigns it to a pane.
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
	);

	const onDragEnd = useCallback((event: DragEndEvent) => {
		const sessionId = event.active.data.current?.sessionId as
			| string
			| undefined;
		const paneIndex = event.over?.data.current?.paneIndex as number | undefined;
		if (!sessionId || paneIndex === undefined) return;
		const { activeGroupId, layoutByGroup, setLayout } = useAppStore.getState();
		if (!activeGroupId) return;
		const layout = layoutByGroup[activeGroupId];
		if (!layout) return;
		setLayout(activeGroupId, assignPane(layout, paneIndex, sessionId));
	}, []);

	return (
		<TooltipProvider>
			<DndContext sensors={sensors} onDragEnd={onDragEnd}>
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
							{!hasGroup ? (
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
			</DndContext>
		</TooltipProvider>
	);
}
