import { Check, ListChecks } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";

/** An agent's ExitPlanMode call, rendered as a reviewable plan with an approve
 *  action. Approving leaves plan mode and resumes the agent to implement it;
 *  "Keep planning" just dismisses the buttons so the user can refine via a
 *  follow-up message (the session stays in plan mode). Once acted on, the plan
 *  stays visible as a read-only record. */
export function PlanApproval({
	plan,
	answered,
	onApprove,
}: {
	plan: string;
	answered: boolean;
	onApprove: () => void;
}) {
	const [dismissed, setDismissed] = useState(false);
	const readOnly = answered || dismissed;

	return (
		<div className="flex min-w-0 flex-col gap-2">
			<div className="flex items-center gap-2 px-0.5">
				<span
					className={cn(
						"flex size-5 items-center justify-center rounded-md",
						readOnly
							? "bg-emerald-500/15 text-emerald-500"
							: "bg-primary/15 text-primary",
					)}
				>
					{readOnly ? (
						<Check className="size-3.5" />
					) : (
						<ListChecks className="size-3.5" />
					)}
				</span>
				<span className="text-[13px] font-semibold text-foreground">
					{readOnly ? "Plan" : "Plan ready for review"}
				</span>
			</div>

			<div className="max-h-80 min-w-0 overflow-auto rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
				<Markdown className="min-w-0">{plan}</Markdown>
			</div>

			{readOnly ? null : (
				<div className="flex items-center justify-end gap-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setDismissed(true)}
						className="text-muted-foreground hover:text-foreground"
					>
						Keep planning
					</Button>
					<Button
						size="sm"
						onClick={onApprove}
						className="gap-1.5 bg-foreground text-background hover:bg-foreground/90"
					>
						<Check className="size-3.5" />
						Approve &amp; build
					</Button>
				</div>
			)}
		</div>
	);
}
