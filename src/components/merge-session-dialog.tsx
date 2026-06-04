import { GitMerge, Loader2 } from "lucide-react";
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

const MODES: { value: MergeMode; label: string; hint: string }[] = [
	{ value: "squash", label: "Squash", hint: "Collapse the work into one commit on the base." },
	{ value: "merge", label: "Merge", hint: "Preserve the branch's commits behind a merge commit." },
	{ value: "rebase", label: "Rebase", hint: "Replay the commits onto the base, then fast-forward." },
];

/** Trigger + dialog to fold an isolated session's branch back into its base. */
export function MergeSessionButton({
	sessionId,
	refresh,
}: {
	sessionId: string;
	refresh: () => void;
}) {
	const session = useAppStore((s) => s.sessions[sessionId]);
	const integrate = useAppStore((s) => s.integrateSession);

	const [open, setOpen] = useState(false);
	const [message, setMessage] = useState("");
	const [mode, setMode] = useState<MergeMode>("squash");
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
			setMessage(session.title);
			setMode("squash");
			setConflicts(null);
		}
	};

	const run = async () => {
		setBusy(true);
		setConflicts(null);
		const outcome = await integrate(
			sessionId,
			message.trim() || session.title,
			mode,
		);
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

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="xs"
					className="ml-auto gap-1.5 text-muted-foreground hover:text-foreground"
				>
					<GitMerge className="size-3.5" />
					Merge
				</Button>
			</DialogTrigger>
			<DialogContent className="w-[440px] max-w-[calc(100vw-2rem)] sm:max-w-none">
				<DialogHeader>
					<DialogTitle>Merge into {base}</DialogTitle>
					<DialogDescription>
						Commit this session's changes and fold its branch into {base}. The
						worktree is removed afterward.
					</DialogDescription>
				</DialogHeader>

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
						<span className="text-xs font-medium text-muted-foreground">
							Strategy
						</span>
						<div className="grid grid-cols-3 gap-0.5 rounded-md border border-border/70 bg-muted/30 p-0.5">
							{MODES.map((m) => (
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
							{MODES.find((m) => m.value === mode)?.hint}
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

				<DialogFooter>
					<Button
						onClick={() => void run()}
						disabled={busy}
						className="bg-foreground text-background hover:bg-foreground/90"
					>
						{busy ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							`Merge into ${base}`
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
