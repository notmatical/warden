import {
	Bot,
	ChevronRight,
	CircleAlert,
	CircleCheck,
	Loader2,
} from "lucide-react";
import { type ComponentType, useMemo, useState } from "react";

import { ToolActivity } from "@/components/tool-activity";
import { Markdown } from "@/components/ui/markdown";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { collectSubagents, type Subagent, type SubagentStatus } from "@/lib/subagents";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";

const STATUS_ICON: Record<
	SubagentStatus,
	{ icon: ComponentType<{ className?: string }>; className: string }
> = {
	running: { icon: Loader2, className: "animate-spin text-primary" },
	done: { icon: CircleCheck, className: "text-emerald-500" },
	error: { icon: CircleAlert, className: "text-destructive" },
};

function StatusIcon({ status }: { status: SubagentStatus }) {
	const { icon: Icon, className } = STATUS_ICON[status];
	return <Icon className={cn("size-3.5 shrink-0", className)} />;
}

/** The drill-in view for one subagent: its prompt, the activity it produced, and
 *  its final report. */
function SubagentDetail({ sub }: { sub: Subagent }) {
	return (
		<>
			<SheetHeader className="border-b border-border/60">
				<SheetTitle className="flex items-center gap-2">
					<StatusIcon status={sub.status} />
					<span className="truncate">{sub.label}</span>
				</SheetTitle>
				{sub.subagentType ? (
					<SheetDescription className="font-mono text-[11px]">
						{sub.subagentType}
					</SheetDescription>
				) : null}
			</SheetHeader>
			<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
				{sub.prompt ? (
					<div>
						<div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
							Prompt
						</div>
						<div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-[13px] whitespace-pre-wrap text-foreground/90">
							{sub.prompt}
						</div>
					</div>
				) : null}

				{sub.activity.length > 0 ? (
					<div>
						<div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
							Activity
						</div>
						<ToolActivity items={sub.activity} />
					</div>
				) : null}

				{sub.result ? (
					<div>
						<div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
							Report
						</div>
						<div className="rounded-lg border border-border/50 bg-muted/20 px-3.5 py-2 text-sm">
							<Markdown>{sub.result}</Markdown>
						</div>
					</div>
				) : null}
			</div>
		</>
	);
}

/** Composer-attached, collapsible overview of a session's subagents. Each row
 *  opens a side sheet replaying that subagent's activity. Hidden when the
 *  session has spawned none. */
export function AgentPanel({ sessionId }: { sessionId: string }) {
	const events = useAppStore((s) => s.eventsBySession[sessionId]);
	const subagents = useMemo(
		() => (events ? collectSubagents(events) : []),
		[events],
	);
	const [expanded, setExpanded] = useState(false);
	const [activeId, setActiveId] = useState<string | null>(null);

	if (subagents.length === 0) return null;

	const running = subagents.filter((s) => s.status === "running").length;
	const done = subagents.filter((s) => s.status === "done").length;
	const active = subagents.find((s) => s.id === activeId) ?? null;

	return (
		<div className="mb-1.5 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
			<button
				type="button"
				onClick={() => setExpanded((v) => !v)}
				aria-expanded={expanded}
				className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
			>
				<span className="flex size-5 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
					<Bot className="size-3.5" />
				</span>
				<span className="shrink-0 text-xs font-medium text-foreground">
					Sub-agents
				</span>
				<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
					{done}/{subagents.length}
				</span>
				{running > 0 ? (
					<span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
						<Loader2 className="size-3 animate-spin" />
						{running} running
					</span>
				) : null}
				<ChevronRight
					className={cn(
						"ml-auto size-3.5 shrink-0 text-muted-foreground/50 transition-transform",
						expanded && "rotate-90",
					)}
				/>
			</button>

			{expanded ? (
				<ul className="max-h-56 overflow-auto border-t border-border/60 p-1">
					{subagents.map((sub) => (
						<li key={sub.id}>
							<button
								type="button"
								onClick={() => setActiveId(sub.id)}
								className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50"
							>
								<StatusIcon status={sub.status} />
								<span className="shrink-0 font-medium text-foreground/90">
									{sub.label}
								</span>
								{sub.prompt ? (
									<span className="min-w-0 flex-1 truncate text-muted-foreground/80">
										{sub.prompt}
									</span>
								) : (
									<span className="flex-1" />
								)}
								<ChevronRight className="size-3.5 shrink-0 text-muted-foreground/40" />
							</button>
						</li>
					))}
				</ul>
			) : null}

			<Sheet
				open={active !== null}
				onOpenChange={(open) => {
					if (!open) setActiveId(null);
				}}
			>
				<SheetContent className="w-full gap-0 p-0 data-[side=right]:sm:max-w-2xl">
					{active ? <SubagentDetail sub={active} /> : null}
				</SheetContent>
			</Sheet>
		</div>
	);
}
