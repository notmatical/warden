import { AlertTriangle, Check, ChevronRight, Circle } from "lucide-react";
import { type ReactNode, createContext, useContext, useState } from "react";

import { DiffView } from "@/components/ui/diff-view";
import {
	describeTool,
	pathRelativeTo,
	type ToolDetail,
} from "@/lib/tool-format";
import { cn } from "@/lib/utils";
import type { EventRecord } from "@/types";

/** Session working directory, used to display tool-target paths relative to it
 *  in the diff/code panel headers. Set by `ToolActivity`. */
const WorkingDirContext = createContext<string | undefined>(undefined);

function useDisplayPath(path: string | undefined): string | undefined {
	const cwd = useContext(WorkingDirContext);
	return pathRelativeTo(path, cwd);
}

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

/** Warm code surface (theme token) shared by code/terminal/text panels, matching
 *  the diff viewer so the activity log reads as one piece. */
const CODE_SURFACE = "bg-card text-foreground";

/** A Task/Agent call's short description, for the header. */
function agentDescription(input: unknown): string | undefined {
	if (input && typeof input === "object" && "description" in input) {
		const d = (input as { description?: unknown }).description;
		if (typeof d === "string" && d.trim()) return d.trim();
	}
	return undefined;
}

/** Shared bordered, height-capped, scrollable dark panel for code/text bodies. */
function Panel({
	header,
	headerTitle,
	children,
}: {
	header?: string;
	headerTitle?: string;
	children: ReactNode;
}) {
	return (
		<div className="overflow-hidden rounded-lg border border-border/60">
			{header ? (
				<div
					className="truncate border-b border-border/60 bg-muted/30 px-3 py-1.5 font-mono text-sm text-muted-foreground/80"
					title={headerTitle ?? header}
				>
					{header}
				</div>
			) : null}
			<div className={cn("max-h-72 overflow-auto", CODE_SURFACE)}>{children}</div>
		</div>
	);
}

function CodePanel({ path, text }: { path?: string; text: string }) {
	const display = useDisplayPath(path);
	return (
		<Panel header={display} headerTitle={path}>
			<pre className="m-0 px-3 py-1.5 font-mono text-sm leading-[1.55] whitespace-pre">
				{text}
			</pre>
		</Panel>
	);
}

function TextPanel({ text }: { text: string }) {
	return (
		<Panel>
			<pre className="m-0 px-3 py-1.5 font-mono text-sm leading-[1.55] whitespace-pre-wrap">
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
		<div className="overflow-hidden rounded-lg border border-border/60">
			<div
				className={cn(
					"px-3 py-1.5 font-mono text-[14px] whitespace-pre-wrap",
					CODE_SURFACE,
				)}
			>
				<span className="select-none text-positive">$ </span>
				{command}
			</div>
			{output ? (
				<div
					className={cn(
						"max-h-72 overflow-auto border-t border-border/60",
						CODE_SURFACE,
					)}
				>
					<pre
						className={cn(
							"m-0 px-3 py-1.5 font-mono text-sm leading-[1.55] whitespace-pre-wrap",
							isError && "text-destructive",
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
		<div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
			{todos.map((t, i) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: todos are positional
					key={i}
					className="flex items-center gap-2 text-[12px]"
				>
					{t.status === "completed" ? (
						<Check className="size-3 shrink-0 text-positive" />
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

function DiffDetail({
	path,
	patch,
}: {
	path?: string;
	patch: string;
}) {
	const display = useDisplayPath(path);
	return <DiffView path={display} pathTitle={path} patch={patch} />;
}

function DetailPanel({ detail }: { detail: ToolDetail }) {
	switch (detail.kind) {
		case "diff":
			return <DiffDetail path={detail.path} patch={detail.patch} />;
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

/** Shared row chrome: a plain, text-forward summary line that toggles a detail
 *  card (no per-row box — the card below is the only surface). */
function Row({
	open,
	onToggle,
	expandable,
	error,
	children,
	body,
}: {
	open: boolean;
	onToggle: () => void;
	expandable: boolean;
	error?: boolean;
	children: ReactNode;
	body?: ReactNode;
}) {
	return (
		<div className="min-w-0">
			<button
				type="button"
				disabled={!expandable}
				onClick={onToggle}
				aria-expanded={expandable ? open : undefined}
				className={cn(
					"flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px]",
					expandable ? "hover:bg-muted/40" : "cursor-default",
				)}
			>
				{children}
				{error ? (
					<AlertTriangle className="size-3.5 shrink-0 text-destructive" />
				) : null}
				{expandable ? (
					<ChevronRight
						className={cn(
							"size-3.5 shrink-0 text-muted-foreground/50 transition-transform",
							open && "rotate-90",
						)}
					/>
				) : null}
			</button>
			{open && body ? <div className="mt-1 min-w-0 pl-1.5">{body}</div> : null}
		</div>
	);
}

function ToolRow({ step }: { step: ToolStepData }) {
	const view = describeTool(step.name, step.input, step.result);
	const error = step.result?.isError ?? false;
	const [open, setOpen] = useState(error || VERBOSE_TOOLS.has(step.name));
	const expandable = !!view.detail;
	const hasCounts = !!(view.added || view.removed);
	// A new file reads as a creation — tint the verb green like its all-add diff.
	const verbClass = step.name === "Write" ? "text-positive" : "text-foreground/90";

	return (
		<Row
			open={open}
			onToggle={() => setOpen((v) => !v)}
			expandable={expandable}
			error={error}
			body={view.detail ? <DetailPanel detail={view.detail} /> : null}
		>
			<span className="flex min-w-0 flex-1 items-center gap-2">
				<span className={cn("shrink-0 font-medium", verbClass)}>
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
				<span className="shrink-0 text-[12px] tabular-nums">
					{view.added ? (
						<span className="text-positive">+{view.added}</span>
					) : null}
					{view.added && view.removed ? " " : null}
					{view.removed ? (
						<span className="text-destructive">−{view.removed}</span>
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
			open={open}
			onToggle={() => setOpen((v) => !v)}
			expandable={children.length > 0}
			error={error}
			body={
				<div className="flex flex-col gap-0.5 border-l border-border/40 pl-3">
					{children.map((c) => (
						<StepNode key={c.id} step={c} />
					))}
				</div>
			}
		>
			<span className="flex min-w-0 flex-1 items-center gap-2">
				<span className="shrink-0 font-medium text-foreground/90">
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
			open={open}
			onToggle={() => setOpen((v) => !v)}
			expandable
			body={
				<div className="py-1 text-[12px] whitespace-pre-wrap text-muted-foreground italic">
					{text}
				</div>
			}
		>
			<span className="shrink-0 font-medium text-muted-foreground">Thought</span>
			<span className="min-w-0 flex-1 truncate text-muted-foreground/70 italic">
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
 *  text-forward summary lines that each expand into a single detail card (diff,
 *  code, terminal output, …). Subagent (Task) calls nest their own rows.
 *  `workingDir` lets path headers in the body render relative to the session's
 *  working directory instead of as long absolute paths. */
export function ToolActivity({
	items,
	workingDir,
}: {
	items: EventRecord[];
	workingDir?: string;
}) {
	const steps = buildSteps(items);
	if (steps.length === 0) return null;

	return (
		<WorkingDirContext.Provider value={workingDir}>
			<div className="flex min-w-0 flex-col gap-1">
				{steps.map((step) => (
					<StepNode key={step.id} step={step} />
				))}
			</div>
		</WorkingDirContext.Provider>
	);
}
