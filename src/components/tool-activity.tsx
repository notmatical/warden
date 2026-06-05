import { AlertTriangle, Bot, ChevronRight, Sparkles, Wrench } from "lucide-react";
import { useState } from "react";

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

function prettyInput(input: unknown): string {
	if (input === null || input === undefined) return "";
	if (typeof input === "string") return input;
	try {
		return JSON.stringify(input, null, 2);
	} catch {
		return String(input);
	}
}

function CodeBlob({ text, tone }: { text: string; tone?: "error" }) {
	if (!text) return null;
	return (
		<pre
			className={cn(
				"mt-1 max-h-60 overflow-auto rounded bg-background/60 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap",
				tone === "error" ? "text-destructive" : "text-muted-foreground",
			)}
		>
			{text}
		</pre>
	);
}

/** A Task/Agent call's short description, for the header. */
function agentDescription(input: unknown): string | undefined {
	if (input && typeof input === "object" && "description" in input) {
		const d = (input as { description?: unknown }).description;
		if (typeof d === "string" && d.trim()) return d.trim();
	}
	return undefined;
}

function ToolStep({ step }: { step: ToolStepData }) {
	const children = step.children;
	const isAgent = !!children && children.length > 0;
	const desc = isAgent ? agentDescription(step.input) : undefined;
	return (
		<div className="border-t border-border/50 px-3 py-2 first:border-t-0">
			<div className="flex items-center gap-1.5 font-mono text-[12px] text-foreground">
				{isAgent ? (
					<Bot className="size-3 shrink-0 text-muted-foreground" />
				) : (
					<Wrench className="size-3 shrink-0 text-muted-foreground" />
				)}
				<span className="truncate">
					{step.name}
					{desc ? (
						<span className="text-muted-foreground"> · {desc}</span>
					) : null}
				</span>
				{isAgent ? (
					<span className="shrink-0 text-muted-foreground">
						{children.length} step{children.length > 1 ? "s" : ""}
					</span>
				) : null}
				{step.result?.isError && (
					<span className="shrink-0 text-destructive">· error</span>
				)}
			</div>
			{/* A subagent shows its nested tools instead of its raw prompt. */}
			{isAgent ? (
				<div className="mt-1.5 ml-1 border-l border-border/40 pl-1.5">
					{children.map((c) => (
						<ToolStep key={c.id} step={c} />
					))}
				</div>
			) : (
				<CodeBlob text={prettyInput(step.input)} />
			)}
			{step.result && (
				<CodeBlob
					text={step.result.content}
					tone={step.result.isError ? "error" : undefined}
				/>
			)}
		</div>
	);
}

function ThinkingStep({ text }: { text: string }) {
	return (
		<div className="border-t border-border/50 px-3 py-2 text-[12px] whitespace-pre-wrap text-muted-foreground italic first:border-t-0">
			{text}
		</div>
	);
}

/** A non-intrusive, collapsible summary of a contiguous block of agent tool use
 *  and thinking — modeled on Claude Desktop's collapsed activity rows. */
export function ToolActivity({ items }: { items: EventRecord[] }) {
	const steps = buildSteps(items);
	const toolNames = steps
		.filter((s): s is Extract<Step, { kind: "tool" }> => s.kind === "tool")
		.map((s) => s.name);
	const hasThinking = steps.some((s) => s.kind === "thinking");
	const hasError = steps.some((s) => s.kind === "tool" && s.result?.isError);

	const [open, setOpen] = useState(hasError);

	// skip empty/redacted thinking blocks
	if (steps.length === 0) return null;

	const uniqueNames = [...new Set(toolNames)];
	const summary =
		toolNames.length > 0
			? `${toolNames.length} tool call${toolNames.length > 1 ? "s" : ""}`
			: "Thought for a moment";

	return (
		<div
			className={cn(
				"rounded-lg border bg-muted/30 text-xs",
				hasError ? "border-destructive/40" : "border-border/60",
			)}
		>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted-foreground"
			>
				{hasThinking && toolNames.length === 0 ? (
					<Sparkles className="size-3.5 shrink-0" />
				) : (
					<Wrench className="size-3.5 shrink-0" />
				)}
				<span className="font-medium text-foreground/80">{summary}</span>
				{uniqueNames.length > 0 && (
					<span className="truncate font-mono text-muted-foreground/70">
						{uniqueNames.join(" · ")}
					</span>
				)}
				{hasError && (
					<AlertTriangle className="size-3.5 shrink-0 text-destructive" />
				)}
				<ChevronRight
					className={cn(
						"ml-auto size-3.5 shrink-0 transition-transform",
						open && "rotate-90",
					)}
				/>
			</button>
			{open && (
				<div className="border-t border-border/60">
					{steps.map((step) =>
						step.kind === "thinking" ? (
							<ThinkingStep key={step.id} text={step.text} />
						) : (
							<ToolStep key={step.id} step={step} />
						),
					)}
				</div>
			)}
		</div>
	);
}
