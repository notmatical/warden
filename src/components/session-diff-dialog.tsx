import { FileDiff, GitCommit as GitCommitIcon, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { DiffLines } from "@/components/ui/diff-view";
import * as ipc from "@/lib/ipc";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { DiffFile, GitCommit } from "@/types/git-diff";

type Tab = "files" | "commits";

/** Trigger + dialog showing a session's changes (files + commits) since base. */
export function SessionDiffButton({ sessionId }: { sessionId: string }) {
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<Tab>("files");
	const [files, setFiles] = useState<DiffFile[]>([]);
	const [commits, setCommits] = useState<GitCommit[]>([]);
	const [active, setActive] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const onOpenChange = async (next: boolean) => {
		setOpen(next);
		if (!next) return;
		setTab("files");
		setLoading(true);
		const [f, c] = await Promise.all([
			ipc.getSessionDiff(sessionId).catch(() => []),
			ipc.getSessionCommits(sessionId).catch(() => []),
		]);
		setFiles(f);
		setCommits(c);
		setActive(f[0]?.path ?? null);
		setLoading(false);
	};

	const current = files.find((f) => f.path === active);

	return (
		<Dialog open={open} onOpenChange={(n) => void onOpenChange(n)}>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="xs"
					className="gap-1.5 text-muted-foreground hover:text-foreground"
				>
					<FileDiff className="size-3.5" />
					Diff
				</Button>
			</DialogTrigger>
			<DialogContent className="grid h-[600px] w-[min(860px,calc(100vw-2rem))] max-w-none grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-none">
				<DialogHeader className="border-b border-border/60 px-4 py-3">
					<DialogTitle className="text-sm">Session changes</DialogTitle>
				</DialogHeader>

				<div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
					{(["files", "commits"] as const).map((t) => (
						<button
							key={t}
							type="button"
							onClick={() => setTab(t)}
							className={cn(
								"flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
								tab === t
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{t === "files" ? (
								<FileDiff className="size-3.5" />
							) : (
								<GitCommitIcon className="size-3.5" />
							)}
							{t === "files" ? `Files (${files.length})` : `Commits (${commits.length})`}
						</button>
					))}
				</div>

				{loading ? (
					<div className="flex items-center justify-center text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
					</div>
				) : tab === "files" ? (
					files.length === 0 ? (
						<div className="flex items-center justify-center text-sm text-muted-foreground">
							No changes since the session started.
						</div>
					) : (
						<div className="grid min-h-0 grid-cols-[220px_minmax(0,1fr)]">
							<div className="overflow-y-auto border-r border-border/60 p-1.5">
								{files.map((f) => (
									<button
										key={f.path}
										type="button"
										onClick={() => setActive(f.path)}
										title={f.path}
										className={cn(
											"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
											f.path === active
												? "bg-accent text-foreground"
												: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
										)}
									>
										<span className="min-w-0 flex-1 truncate">
											{f.path.split("/").pop()}
										</span>
										<span className="shrink-0 tabular-nums text-[10px]">
											<span className="text-emerald-500">+{f.added}</span>{" "}
											<span className="text-red-500">−{f.removed}</span>
										</span>
									</button>
								))}
							</div>
							<div className="min-w-0 overflow-auto">
								{current?.binary ? (
									<p className="p-4 text-xs text-muted-foreground">
										Binary file — no textual diff.
									</p>
								) : current ? (
									<DiffLines patch={current.patch} path={current.path} />
								) : null}
							</div>
						</div>
					)
				) : commits.length === 0 ? (
					<div className="flex items-center justify-center text-sm text-muted-foreground">
						No commits yet.
					</div>
				) : (
					<div className="divide-y divide-border/50 overflow-y-auto">
						{commits.map((c) => (
							<div key={c.sha} className="flex items-baseline gap-3 px-4 py-2.5">
								<code className="shrink-0 font-mono text-[11px] text-muted-foreground">
									{c.sha.slice(0, 7)}
								</code>
								<span className="min-w-0 flex-1 truncate text-sm">
									{c.subject}
								</span>
								<span className="shrink-0 text-[11px] text-muted-foreground">
									{c.author} · {relativeTime(c.date)}
								</span>
							</div>
						))}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
