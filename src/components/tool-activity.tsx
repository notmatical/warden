import {
	AlertTriangle,
	Bot,
	Brain,
	Check,
	ChevronRight,
	Circle,
	FilePen,
	FileText,
	Globe,
	ListChecks,
	Search,
	Terminal,
	Wrench,
} from "lucide-react";
import { type ComponentType, type ReactNode, useState } from "react";

import { DiffView } from "@/components/ui/diff-view";
import { describeTool, type ToolDetail } from "@/lib/tool-format";
import { cn } from "@/lib/utils";
import type { EventRecord } from "@/types";

interface ToolStepData {
	kind: "tool";
	id: string;
	name: string;
	input: unknown;
	result?: { content: string; isError: boolean };
	/** Subagent (Task/Agent) calls nest the tools they spawned here. */
	children?: ToolStepData[];
}

type Step = { kind: "thinking"; id: string; text: string } | ToolStepData;

/** Collapse a run of thinking/tool_use/tool_result events into ordered steps,
 *  pairing each result to its call and nesting a subagent's tools (those with a
 *  `parent_tool_use_id`) under the Task/Agent step that spawned them. */
function buildSteps(items: EventRecord[]): Step[] {
	const steps: Step[] = [];
	const byId = new Map<string, ToolStepData>();

	for (const item of items) {
		if (item.type === "thinking") {
			if (item.text.trim()) {
				steps.push({ kind: "thinking", id: item.id, text: item.text });
			}
		} else if (item.type === "tool_use") {
			const step: ToolStepData = {
				kind: "tool",
				id: item.id,
				name: item.name,
				input: item.input,
			};
			byId.set(item.id, step);
			const parent = item.parent_tool_use_id
				? byId.get(item.parent_tool_use_id)
				: undefined;
			if (parent) {
				(parent.children ??= []).push(step);
			} else {
				steps.push(step);
			}
		} else if (item.type === "tool_result") {
			// Pair to its call wherever it sits (top-level or nested under a Task).
			const target = byId.get(item.tool_use_id);
			if (target) {
				target.result = { content: item.content, isError: item.is_error };
			} else {
				steps.push({
					kind: "tool",
					id: item.id,
					name: "result",
					input: undefined,
					result: { content: item.content, isError: item.is_error },
				});
			}
		}
	}

	return steps;
}

const TOOL_ICONS: Record<string, ComponentType<{ className?: string }>> = {
	Read: FileText,
	Edit: FilePen,
	MultiEdit: FilePen,
	Write: FilePen,
	NotebookEdit: FilePen,
	Bash: Terminal,
	Grep: Search,
	Glob: Search,
	WebSearch: Search,
	WebFetch: Globe,
	TodoWrite: ListChecks,
};

function toolIcon(name: string): ComponentType<{ className?: string }> {
	return TOOL_ICONS[name] ?? Wrench;
}

/** Tools whose detail is the point of the call — shown expanded by default
 *  ("verbose" view). Lookups/searches stay collapsed to keep the log scannable. */
const VERBOSE_TOOLS = new Set([
	"Edit",
	"MultiEdit",
	"Write",
	"NotebookEdit",
	"Bash",
	"TodoWrite",
]);

/** Dark code surface shared by code/terminal/text panels, matching the diff
 *  viewer's syntax-highlight theme so the activity log reads as one piece. */
const CODE_SURFACE = "bg-[#24292e] text-[#c9d1d9]";

/** A Task/Agent call's short description, for the header. */
function agentDescription(input: unknown): string | undefined {
	if (input && typeof input === "object" && "description" in input) {
		const d = (input as { description?: unknown }).description;
		if (typeof d === "string" && d.trim()) return d.trim();
	}
	return undefined;
}

/** Shared bordered, height-capped, scrollable dark panel for code/text bodies. */
function Panel({ header, children }: { header?: string; children: ReactNode }) {
	return (
		<div className="mt-1 overflow-hidden rounded-lg border border-border/60">
			{header ? (
				<div
					className="truncate border-b border-border/60 bg-muted/40 px-3 py-1.5 font-mono text-[11px] text-muted-foreground"
					title={header}
				>
					{header}
				</div>
			) : null}
			<div className={cn("max-h-72 overflow-auto", CODE_SURFACE)}>{children}</div>
		</div>
	);
}

function CodePanel({ path, text }: { path?: string; text: string }) {
	return (
		<Panel header={path}>
			<pre className="m-0 px-3 py-1.5 font-mono text-[12px] leading-[1.6] whitespace-pre">
				{text}
			</pre>
		</Panel>
	);
}

function TextPanel({ text }: { text: string }) {
	return (
		<Panel>
			<pre className="m-0 px-3 py-1.5 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap">
				{text}
			</pre>
		</Panel>
	);
}

function TerminalPanel({
	command,
	output,
	isError,
}: {
	command: string;
	output: string;
	isError: boolean;
}) {
	return (
		<div className="mt-1 overflow-hidden rounded-lg border border-border/60">
			<div
				className={cn(
					"px-3 py-1.5 font-mono text-[12px] whitespace-pre-wrap",
					CODE_SURFACE,
				)}
			>
				<span className="select-none text-emerald-400">$ </span>
				{command}
			</div>
			{output ? (
				<div
					className={cn(
						"max-h-72 overflow-auto border-t border-white/10",
						CODE_SURFACE,
					)}
				>
					<pre
						className={cn(
							"m-0 px-3 py-1.5 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap",
							isError && "text-red-400",
						)}
					>
						{output}
					</pre>
				</div>
			) : null}
		</div>
	);
}

function TodoPanel({
	todos,
}: {
	todos: { content: string; status: string }[];
}) {
	return (
		<div className="mt-1 flex flex-col gap-1.5 rounded-md border border-border/60 bg-background/40 px-3 py-2">
			{todos.map((t, i) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: todos are positional
					key={i}
					className="flex items-center gap-2 text-[12px]"
				>
					{t.status === "completed" ? (
						<Check className="size-3 shrink-0 text-emerald-500" />
					) : t.status === "in_progress" ? (
						<Circle className="size-3 shrink-0 fill-primary/20 text-primary" />
					) : (
						<Circle className="size-3 shrink-0 text-muted-foreground/40" />
					)}
					<span
						className={cn(
							t.status === "completed"
								? "text-muted-foreground line-through"
								: t.status === "in_progress"
									? "text-foreground"
									: "text-muted-foreground",
						)}
					>
						{t.content}
					</span>
				</div>
			))}
		</div>
	);
}

function DetailPanel({ detail }: { detail: ToolDetail }) {
	switch (detail.kind) {
		case "diff":
			return <DiffView path={detail.path} patch={detail.patch} className="mt-1" />;
		case "code":
			return <CodePanel path={detail.path} text={detail.text} />;
		case "terminal":
			return (
				<TerminalPanel
					command={detail.command}
					output={detail.output}
					isError={detail.isError}
				/>
			);
		case "todos":
			return <TodoPanel todos={detail.todos} />;
		case "text":
			return <TextPanel text={detail.text} />;
	}
}

/** Shared row chrome: an icon + summary line that toggles a detail body. */
function Row({
	icon: Icon,
	iconClass,
	open,
	onToggle,
	expandable,
	error,
	children,
	body,
}: {
	icon: ComponentType<{ className?: string }>;
	iconClass?: string;
	open: boolean;
	onToggle: () => void;
	expandable: boolean;
	error?: boolean;
	children: ReactNode;
	body?: ReactNode;
}) {
	return (
		<div>
			<button
				type="button"
				disabled={!expandable}
				onClick={onToggle}
				aria-expanded={expandable ? open : undefined}
				className={cn(
					"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]",
					expandable ? "hover:bg-muted/50" : "cursor-default",
				)}
			>
				<Icon
					className={cn(
						"size-3.5 shrink-0",
						error ? "text-destructive" : (iconClass ?? "text-muted-foreground"),
					)}
				/>
				{children}
				{error ? (
					<AlertTriangle className="size-3.5 shrink-0 text-destructive" />
				) : null}
				{expandable ? (
					<ChevronRight
						className={cn(
							"size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
							open && "rotate-90",
						)}
					/>
				) : null}
			</button>
			{open && body ? (
				<div className="min-w-0 pr-1 pl-6">{body}</div>
			) : null}
		</div>
	);
}

function ToolRow({ step }: { step: ToolStepData }) {
	const view = describeTool(step.name, step.input, step.result);
	const error = step.result?.isError ?? false;
	const [open, setOpen] = useState(error || VERBOSE_TOOLS.has(step.name));
	const expandable = !!view.detail;
	const hasCounts = !!(view.added || view.removed);

	return (
		<Row
			icon={toolIcon(step.name)}
			open={open}
			onToggle={() => setOpen((v) => !v)}
			expandable={expandable}
			error={error}
			body={view.detail ? <DetailPanel detail={view.detail} /> : null}
		>
			<span className="flex min-w-0 flex-1 items-center gap-2">
				<span className="shrink-0 font-medium text-foreground/80">
					{view.verb}
				</span>
				{view.target ? (
					<span
						className="truncate font-mono text-[12px] text-muted-foreground"
						title={view.target}
					>
						{view.label ?? view.target}
					</span>
				) : null}
			</span>
			{hasCounts ? (
				<span className="shrink-0 tabular-nums text-[11px]">
					{view.added ? (
						<span className="text-emerald-500">+{view.added}</span>
					) : null}
					{view.added && view.removed ? " " : null}
					{view.removed ? (
						<span className="text-red-500">−{view.removed}</span>
					) : null}
				</span>
			) : null}
		</Row>
	);
}

function AgentRow({ step }: { step: ToolStepData }) {
	const children = step.children ?? [];
	const desc = agentDescription(step.input);
	const error = step.result?.isError ?? false;
	const [open, setOpen] = useState(false);

	return (
		<Row
			icon={Bot}
			open={open}
			onToggle={() => setOpen((v) => !v)}
			expandable={children.length > 0}
			error={error}
			body={
				<div className="mt-0.5 flex flex-col gap-0.5 border-l border-border/40 pl-2">
					{children.map((c) => (
						<StepNode key={c.id} step={c} />
					))}
				</div>
			}
		>
			<span className="flex min-w-0 flex-1 items-center gap-2">
				<span className="shrink-0 font-medium text-foreground/80">
					{step.name}
				</span>
				{desc ? (
					<span className="truncate text-muted-foreground" title={desc}>
						{desc}
					</span>
				) : null}
			</span>
			{children.length > 0 ? (
				<span className="shrink-0 text-[11px] text-muted-foreground/70">
					{children.length} step{children.length > 1 ? "s" : ""}
				</span>
			) : null}
		</Row>
	);
}

function ThinkingRow({ text }: { text: string }) {
	const [open, setOpen] = useState(false);
	const preview = text.trim().split("\n", 1)[0];

	return (
		<Row
			icon={Brain}
			open={open}
			onToggle={() => setOpen((v) => !v)}
			expandable
			body={
				<div className="py-1 text-[12px] whitespace-pre-wrap text-muted-foreground italic">
					{text}
				</div>
			}
		>
			<span className="shrink-0 font-medium text-foreground/80">Thought</span>
			<span className="min-w-0 flex-1 truncate text-muted-foreground italic">
				{preview}
			</span>
		</Row>
	);
}

function StepNode({ step }: { step: Step }) {
	if (step.kind === "thinking") return <ThinkingRow text={step.text} />;
	if (step.children && step.children.length > 0) return <AgentRow step={step} />;
	return <ToolRow step={step} />;
}

/** A contiguous block of agent tool use and thinking, rendered as Claude-style
 *  per-tool summary rows that each expand into a detail panel (diff, code,
 *  terminal output, …). Subagent (Task) calls nest their own rows. */
export function ToolActivity({ items }: { items: EventRecord[] }) {
	const steps = buildSteps(items);
	if (steps.length === 0) return null;

	const hasError = steps.some(
		(s) => s.kind === "tool" && s.result?.isError === true,
	);

	return (
		<div
			className={cn(
				"flex min-w-0 flex-col gap-0.5 rounded-lg border bg-muted/20 p-1",
				hasError ? "border-destructive/30" : "border-border/50",
			)}
		>
			{steps.map((step) => (
				<StepNode key={step.id} step={step} />
			))}
		</div>
	);
}
