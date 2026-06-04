import { ArrowDown, ArrowUp, GitBranch, Plus, X } from "lucide-react";
import { useCallback } from "react";

import { MergeSessionButton } from "@/components/merge-session-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as ipc from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { Project, RepoStatus } from "@/types";

// Stable empty reference so the `?? EMPTY` fallback doesn't allocate each run.
const EMPTY: Project[] = [];

function Counter({ added, removed }: { added: number; removed: number }) {
	if (added === 0 && removed === 0) return null;
	return (
		<span className="inline-flex items-center gap-1 tabular-nums">
			<span
				className={cn(
					added > 0 ? "text-emerald-500" : "text-muted-foreground/60",
				)}
			>
				+{added}
			</span>
			<span
				className={cn(
					removed > 0 ? "text-red-500" : "text-muted-foreground/60",
				)}
			>
				−{removed}
			</span>
		</span>
	);
}

function StatusChip({
	status,
	onRemove,
}: {
	status: RepoStatus;
	onRemove?: () => void;
}) {
	return (
		<span
			className={cn(
				"group/chip inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs text-muted-foreground",
				status.isPrimary ? "bg-muted/60" : "bg-muted/30",
			)}
			title={status.path}
		>
			<span
				className={cn("font-medium", status.isPrimary && "text-foreground/80")}
			>
				{status.name}
			</span>
			{status.branch ? (
				<span className="inline-flex items-center gap-1">
					<GitBranch className="size-3 opacity-60" />
					{status.branch}
				</span>
			) : null}
			<Counter
				added={status.uncommittedAdded}
				removed={status.uncommittedRemoved}
			/>
			{status.ahead > 0 ? (
				<span className="inline-flex items-center tabular-nums">
					<ArrowUp className="size-3" />
					{status.ahead}
				</span>
			) : null}
			{status.behind > 0 ? (
				<span className="inline-flex items-center tabular-nums">
					<ArrowDown className="size-3" />
					{status.behind}
				</span>
			) : null}
			{onRemove ? (
				<button
					type="button"
					onClick={onRemove}
					aria-label={`Remove ${status.name} from this session`}
					className="-mr-0.5 ml-0.5 hidden size-4 items-center justify-center rounded text-muted-foreground/70 transition group-hover/chip:inline-flex hover:bg-muted hover:text-foreground"
				>
					<X className="size-3" />
				</button>
			) : null}
		</span>
	);
}

// The session's roots are exactly the git-status rows; non-primary project ids
// are the editable set handed to `set_session_roots`.
function nonPrimaryIds(statuses: RepoStatus[]): string[] {
	return statuses.filter((s) => !s.isPrimary).map((s) => s.projectId);
}

function AddRootControl({
	sessionId,
	statuses,
	refresh,
}: {
	sessionId: string;
	statuses: RepoStatus[];
	refresh: () => void;
}) {
	const groupRoots = useAppStore((s) =>
		s.activeGroupId ? (s.rootsByGroup[s.activeGroupId] ?? EMPTY) : EMPTY,
	);

	const add = useCallback(
		(projectId: string) => {
			void ipc
				.setSessionRoots(sessionId, [...nonPrimaryIds(statuses), projectId])
				.then(refresh)
				.catch(() => {});
		},
		[sessionId, statuses, refresh],
	);

	const onSession = new Set(statuses.map((s) => s.projectId));
	const available = groupRoots.filter((p) => !onSession.has(p.id));
	if (available.length === 0) return null;

	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon-xs"
					title="Add a repository to this session"
					className="text-muted-foreground hover:text-foreground"
				>
					<Plus />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-56">
				<DropdownMenuLabel>Add a root</DropdownMenuLabel>
				{available.map((project) => (
					<DropdownMenuItem
						key={project.id}
						onSelect={() => add(project.id)}
						className="gap-2"
					>
						<Plus className="size-3.5 text-muted-foreground" />
						<span className="truncate">{project.name}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

interface GitStatusChipsProps {
	statuses: RepoStatus[];
	sessionId: string;
	refresh: () => void;
}

export function GitStatusChips({
	statuses,
	sessionId,
	refresh,
}: GitStatusChipsProps) {
	const remove = useCallback(
		(projectId: string) => {
			void ipc
				.setSessionRoots(
					sessionId,
					nonPrimaryIds(statuses).filter((id) => id !== projectId),
				)
				.then(refresh)
				.catch(() => {});
		},
		[sessionId, statuses, refresh],
	);

	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-1.5 px-1",
				statuses.length > 0 ? "pb-1.5" : "empty:hidden",
			)}
		>
			{statuses.map((status) => (
				<StatusChip
					key={status.projectId}
					status={status}
					onRemove={
						status.isPrimary ? undefined : () => remove(status.projectId)
					}
				/>
			))}
			<AddRootControl
				sessionId={sessionId}
				statuses={statuses}
				refresh={refresh}
			/>
			<MergeSessionButton sessionId={sessionId} refresh={refresh} />
		</div>
	);
}
