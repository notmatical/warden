import { GitMerge, GitPullRequest, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { MergeMode } from "@/types";

type LandMode = "merge" | "pr";

const MERGE_MODES: { value: MergeMode; label: string; hint: string }[] = [
	{ value: "squash", label: "Squash", hint: "Collapse the work into one commit on the base." },
	{ value: "merge", label: "Merge", hint: "Preserve the branch's commits behind a merge commit." },
	{ value: "rebase", label: "Rebase", hint: "Replay the commits onto the base, then fast-forward." },
];

/** Trigger + dialog to land an isolated session: fold its branch into the base
 *  locally, or open a pull request from it. */
export function LandSessionButton({
	sessionId,
	hasRemote,
	refresh,
}: {
	sessionId: string;
	hasRemote: boolean;
	refresh: () => void;
}) {
	const session = useAppStore((s) => s.sessions[sessionId]);
	const integrate = useAppStore((s) => s.integrateSession);
	const openPr = useAppStore((s) => s.openPullRequest);

	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<LandMode>("merge");
	const [message, setMessage] = useState("");
	const [mode, setMode] = useState<MergeMode>("squash");
	const [prTitle, setPrTitle] = useState("");
	const [prBody, setPrBody] = useState("");
	const [busy, setBusy] = useState(false);
	const [conflicts, setConflicts] = useState<string[] | null>(null);

	// Only isolated sessions that have run and aren't already merged can land.
	if (
		!session ||
		!session.isIsolated ||
		!session.branch ||
		session.mergedAt ||
		session.turns === 0
	) {
		return null;
	}
	const base = session.baseBranch ?? "base";

	const onOpenChange = (next: boolean) => {
		setOpen(next);
		if (next) {
			setTab(hasRemote ? "pr" : "merge");
			setMessage(session.title);
			setMode("squash");
			setPrTitle(session.title);
			setPrBody("");
			setConflicts(null);
		}
	};

	const runMerge = async () => {
		setBusy(true);
		setConflicts(null);
		const outcome = await integrate(sessionId, message.trim() || session.title, mode);
		setBusy(false);
		if (!outcome) return;
		if (outcome.status === "conflict") {
			setConflicts(outcome.files);
			return;
		}
		toast.success(`Merged into ${base}`);
		setOpen(false);
		refresh();
	};

	const runPr = async () => {
		setBusy(true);
		const pr = await openPr(sessionId, prTitle.trim() || session.title, prBody.trim());
		setBusy(false);
		if (!pr) return;
		toast.success(`Opened pull request #${pr.number}`);
		setOpen(false);
		refresh();
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="xs"
					className="ml-auto gap-1.5 text-muted-foreground hover:text-foreground"
				>
					<GitPullRequest className="size-3.5" />
					Land
				</Button>
			</DialogTrigger>
			<DialogContent className="w-[460px] max-w-[calc(100vw-2rem)] sm:max-w-none">
				<DialogHeader>
					<DialogTitle>Land session</DialogTitle>
					<DialogDescription>
						Open a pull request from this session's branch, or fold it into{" "}
						{base} locally.
					</DialogDescription>
				</DialogHeader>

				<div className="grid grid-cols-2 gap-0.5 rounded-md border border-border/70 bg-muted/30 p-0.5">
					<button
						type="button"
						onClick={() => hasRemote && setTab("pr")}
						disabled={!hasRemote}
						title={hasRemote ? undefined : "No git remote to push to"}
						className={cn(
							"flex items-center justify-center gap-1.5 rounded-[5px] px-2 py-1.5 text-xs font-medium transition-colors",
							tab === "pr"
								? "bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
								: "text-muted-foreground hover:text-foreground",
							!hasRemote && "cursor-not-allowed opacity-40 hover:text-muted-foreground",
						)}
					>
						<GitPullRequest className="size-3.5" />
						Pull request
					</button>
					<button
						type="button"
						onClick={() => setTab("merge")}
						className={cn(
							"flex items-center justify-center gap-1.5 rounded-[5px] px-2 py-1.5 text-xs font-medium transition-colors",
							tab === "merge"
								? "bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						<GitMerge className="size-3.5" />
						Merge locally
					</button>
				</div>

				{tab === "pr" ? (
					<div className="flex flex-col gap-3">
						<label className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-muted-foreground">Title</span>
							<input
								value={prTitle}
								onChange={(e) => setPrTitle(e.target.value)}
								className="h-8 rounded-md border border-border bg-input/40 px-2.5 text-sm outline-none focus-visible:border-ring"
							/>
						</label>
						<label className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-muted-foreground">
								Description
							</span>
							<textarea
								value={prBody}
								onChange={(e) => setPrBody(e.target.value)}
								rows={4}
								placeholder="Optional"
								className="resize-none rounded-md border border-border bg-input/40 px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
							/>
						</label>
						<span className="text-[11px] text-muted-foreground">
							Commits and pushes the branch, then opens a PR into {base}.
						</span>
					</div>
				) : (
					<div className="flex flex-col gap-3">
						<label className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-muted-foreground">
								Commit message
							</span>
							<input
								value={message}
								onChange={(e) => setMessage(e.target.value)}
								className="h-8 rounded-md border border-border bg-input/40 px-2.5 text-sm outline-none focus-visible:border-ring"
							/>
						</label>

						<div className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-muted-foreground">Strategy</span>
							<div className="grid grid-cols-3 gap-0.5 rounded-md border border-border/70 bg-muted/30 p-0.5">
								{MERGE_MODES.map((m) => (
									<button
										key={m.value}
										type="button"
										onClick={() => setMode(m.value)}
										className={cn(
											"rounded-[5px] px-2 py-1 text-[11px] font-medium transition-colors",
											mode === m.value
												? "bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										{m.label}
									</button>
								))}
							</div>
							<span className="text-[11px] text-muted-foreground">
								{MERGE_MODES.find((m) => m.value === mode)?.hint}
							</span>
						</div>

						{conflicts && (
							<div className="flex flex-col gap-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
								<span className="text-xs font-medium text-amber-600 dark:text-amber-500">
									Merge stopped on conflicts. Nothing was changed.
								</span>
								<ul className="font-mono text-[11px] text-muted-foreground">
									{conflicts.map((f) => (
										<li key={f} className="truncate">
											{f}
										</li>
									))}
								</ul>
								<span className="text-[11px] text-muted-foreground">
									Resolve these in the worktree, then merge again.
								</span>
							</div>
						)}
					</div>
				)}

				<DialogFooter>
					<Button
						onClick={() => void (tab === "pr" ? runPr() : runMerge())}
						disabled={busy}
						className="bg-foreground text-background hover:bg-foreground/90"
					>
						{busy ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : tab === "pr" ? (
							"Open pull request"
						) : (
							`Merge into ${base}`
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
