import { AlertTriangle, ChevronRight, Sparkles, Wrench } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { EventRecord } from "@/types";

type Step =
	| { kind: "thinking"; id: string; text: string }
	| {
			kind: "tool";
			id: string;
			name: string;
			input: unknown;
			result?: { content: string; isError: boolean };
	  };

/** Collapse a run of thinking/tool_use/tool_result events into ordered steps,
 *  pairing each tool result back to the call that produced it. */
function buildSteps(items: EventRecord[]): Step[] {
	const steps: Step[] = [];
	const toolIndexById = new Map<string, number>();

	for (const item of items) {
		if (item.type === "thinking") {
			steps.push({ kind: "thinking", id: item.id, text: item.text });
		} else if (item.type === "tool_use") {
			toolIndexById.set(item.id, steps.length);
			steps.push({
				kind: "tool",
				id: item.id,
				name: item.name,
				input: item.input,
			});
		} else if (item.type === "tool_result") {
			const idx = toolIndexById.get(item.tool_use_id);
			const target = idx !== undefined ? steps[idx] : undefined;
			if (target && target.kind === "tool") {
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

function ToolStep({ step }: { step: Extract<Step, { kind: "tool" }> }) {
	const input = prettyInput(step.input);
	return (
		<div className="border-t border-border/50 px-3 py-2 first:border-t-0">
			<div className="flex items-center gap-1.5 font-mono text-[12px] text-foreground">
				<Wrench className="size-3 text-muted-foreground" />
				{step.name}
				{step.result?.isError && (
					<span className="text-destructive">· error</span>
				)}
			</div>
			<CodeBlob text={input} />
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
