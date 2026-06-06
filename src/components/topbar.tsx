import { PanelLeft } from "lucide-react";

import { CliUpdates } from "@/components/cli-updates";
import { GithubButton } from "@/components/github-button";
import { OpenInButtons } from "@/components/open-in-buttons";
import { QuickSwitcher } from "@/components/quick-switcher";
import { Button } from "@/components/ui/button";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import { useSidebar } from "@/components/ui/sidebar";
import { useAppStore } from "@/store/app-store";

function SidebarToggle() {
	const { toggleSidebar } = useSidebar();
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			onClick={toggleSidebar}
			aria-label="Toggle sidebar"
			title="Toggle sidebar (Ctrl+B)"
			className="shrink-0 text-muted-foreground hover:text-foreground"
		>
			<PanelLeft />
		</Button>
	);
}

export function Topbar() {
	const collapsed = useSidebar().state === "collapsed";

	// The active session's working directory, falling back to the group's first
	// root.
	const openPath = useAppStore((s) => {
		const session = s.activeSessionId ? s.sessions[s.activeSessionId] : undefined;
		if (session) return session.workingDir;
		const groupId = s.activeGroupId;
		return groupId ? (s.rootsByGroup[groupId]?.[0]?.path ?? null) : null;
	});

	return (
		<header
			data-tauri-drag-region
			className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-4"
		>
			{collapsed ? (
				<HoverCard openDelay={120} closeDelay={120}>
					<HoverCardTrigger asChild>
						<span className="inline-flex">
							<SidebarToggle />
						</span>
					</HoverCardTrigger>
					<HoverCardContent
						align="start"
						sideOffset={8}
						className="w-64 max-h-80 overflow-y-auto rounded-xl p-1.5"
					>
						<QuickSwitcher />
					</HoverCardContent>
				</HoverCard>
			) : (
				<SidebarToggle />
			)}
			<div className="flex-1" />
			<div className="flex items-center gap-1">
				<CliUpdates />
				<GithubButton path={openPath} />
				<div className="mx-0.5 h-4 w-px bg-border/60" />
				<OpenInButtons path={openPath} />
			</div>
		</header>
	);
}
