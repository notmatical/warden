import { GitPullRequest, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import * as ipc from "@/lib/ipc";
import { useAppStore } from "@/store/app-store";
import type { PrSummary } from "@/types";

/** Lists a project's open PRs and checks the chosen one out into a review
 *  worktree. Controlled — opened from the project's new-session menu. */
export function ReviewPrDialog({
	projectId,
	open,
	onOpenChange,
}: {
	projectId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const checkoutPr = useAppStore((s) => s.checkoutPr);
	const [prs, setPrs] = useState<PrSummary[] | null>(null);
	const [busy, setBusy] = useState<number | null>(null);

	useEffect(() => {
		if (!open) return;
		setPrs(null);
		ipc.listOpenPrs(projectId)
			.then(setPrs)
			.catch(() => setPrs([]));
	}, [open, projectId]);

	const pick = async (number: number) => {
		setBusy(number);
		const session = await checkoutPr(projectId, number);
		setBusy(null);
		if (session) onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="w-[min(560px,calc(100vw-2rem))] max-w-none sm:max-w-none">
				<DialogHeader>
					<DialogTitle>Review a pull request</DialogTitle>
					<DialogDescription>
						Check out an open PR into an isolated worktree to run and review it.
					</DialogDescription>
				</DialogHeader>

				{prs === null ? (
					<div className="flex items-center justify-center py-8 text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
					</div>
				) : prs.length === 0 ? (
					<p className="py-8 text-center text-sm text-muted-foreground">
						No open pull requests.
					</p>
				) : (
					<div className="flex max-h-[420px] flex-col gap-0.5 overflow-y-auto">
						{prs.map((pr) => (
							<button
								key={pr.number}
								type="button"
								disabled={busy !== null}
								onClick={() => void pick(pr.number)}
								className="flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent disabled:opacity-50"
							>
								<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground">
									{busy === pr.number ? (
										<Loader2 className="size-3.5 animate-spin" />
									) : (
										<GitPullRequest className="size-3.5" />
									)}
								</span>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm">
										<span className="text-muted-foreground">#{pr.number}</span>{" "}
										{pr.title}
									</span>
									<span className="block truncate text-[11px] text-muted-foreground">
										{pr.author} · {pr.headRef}
									</span>
								</span>
							</button>
						))}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
