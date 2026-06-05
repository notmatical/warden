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
		<div className="mb-1.5 flex flex-col gap-1 px-1">
			<button
				type="button"
				onClick={() => setExpanded((v) => !v)}
				aria-expanded={expanded}
				className={cn(
					"inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs text-muted-foreground transition-colors",
					expanded ? "bg-muted/70 text-foreground" : "bg-muted/40 hover:bg-muted/60",
				)}
			>
				<Bot className="size-3.5 text-primary/80" />
				<span className="font-medium text-foreground/80">Sub-agents</span>
				<span className="tabular-nums text-muted-foreground/70">
					{done}/{subagents.length}
				</span>
				{running > 0 ? (
					<Loader2 className="size-3 animate-spin text-primary/70" />
				) : null}
				<ChevronRight
					className={cn(
						"size-3 text-muted-foreground/50 transition-transform",
						expanded && "rotate-90",
					)}
				/>
			</button>

			{expanded ? (
				<ul className="flex max-h-56 flex-col gap-0.5 overflow-auto rounded-lg border border-border/50 bg-card/60 p-1">
					{subagents.map((sub) => (
						<li key={sub.id}>
							<button
								type="button"
								onClick={() => setActiveId(sub.id)}
								className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/60"
							>
								<StatusIcon status={sub.status} />
								<span className="shrink-0 font-medium text-foreground/90">
									{sub.label}
								</span>
								{sub.prompt ? (
									<span className="min-w-0 flex-1 truncate text-muted-foreground/70">
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
