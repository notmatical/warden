import type { EventRecord } from "@/types";

import { isAgentTool } from "./agent-tools";

export type SubagentStatus = "running" | "done" | "error";

/** A subagent (Task/Agent) call surfaced for the agents panel: its identity, the
 *  prompt it was handed, its live status, the events it produced (for the
 *  activity view), and its final report. */
export interface Subagent {
	id: string;
	label: string;
	subagentType?: string;
	prompt?: string;
	status: SubagentStatus;
	/** Timestamp of the spawning Task call, and of its result (when finished). */
	startedAt: string;
	endedAt?: string;
	/** The subagent's final report — the Task call's result content. */
	result?: string;
	/** Child tool events (for rendering its activity), in stream order. */
	activity: EventRecord[];
}

function readLabel(input: unknown): {
	label: string;
	subagentType?: string;
	prompt?: string;
} {
	const obj = (input && typeof input === "object" ? input : {}) as Record<
		string,
		unknown
	>;
	const desc =
		typeof obj.description === "string" ? obj.description.trim() : "";
	const type =
		typeof obj.subagent_type === "string" ? obj.subagent_type.trim() : "";
	const prompt = typeof obj.prompt === "string" ? obj.prompt : undefined;
	return {
		label: desc || type || "Subagent",
		subagentType: type || undefined,
		prompt,
	};
}

/** Collect the top-level subagents in a session's event log. Each gathers the
 *  tool calls it spawned (via `parent_tool_use_id`, transitively) so the panel
 *  can show one row per agent and a sheet can replay its activity. Nested
 *  sub-subagents stay folded inside their parent's activity. */
export function collectSubagents(events: EventRecord[]): Subagent[] {
	const order: string[] = [];
	const byId = new Map<string, Subagent>();
	const taskIds = new Set<string>();

	for (const e of events) {
		if (e.type === "tool_use" && isAgentTool(e.name) && !e.parent_tool_use_id) {
			const { label, subagentType, prompt } = readLabel(e.input);
			taskIds.add(e.id);
			order.push(e.id);
			byId.set(e.id, {
				id: e.id,
				label,
				subagentType,
				prompt,
				status: "running",
				startedAt: e.ts,
				activity: [],
			});
		}
	}
	if (order.length === 0) return [];

	// Map each descendant tool_use to the root task it belongs to, walking up the
	// parent chain (events are in stream order, so parents precede children).
	const rootOf = new Map<string, string>();
	const rootForParent = (parent: string | undefined): string | undefined => {
		if (!parent) return undefined;
		return taskIds.has(parent) ? parent : rootOf.get(parent);
	};

	for (const e of events) {
		if (e.type === "tool_use") {
			if (taskIds.has(e.id)) continue; // the task itself isn't its own activity
			const root = rootForParent(e.parent_tool_use_id);
			if (root) {
				rootOf.set(e.id, root);
				byId.get(root)?.activity.push(e);
			}
		} else if (e.type === "tool_result") {
			const task = byId.get(e.tool_use_id);
			if (task) {
				// The Task's own result is the subagent's final report + outcome.
				task.result = e.content;
				task.status = e.is_error ? "error" : "done";
				task.endedAt = e.ts;
			} else {
				const root = rootOf.get(e.tool_use_id);
				if (root) byId.get(root)?.activity.push(e);
			}
		}
	}

	return order.map((id) => byId.get(id) as Subagent);
}
