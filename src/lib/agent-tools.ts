/** Tools lifted out of the activity accordion into their own interactive widget
 *  (a question prompt, a plan-approval card) rather than rendered as raw calls. */
export const SPECIAL_TOOLS = new Set<string>([
	"AskUserQuestion",
	"ExitPlanMode",
]);

export function isSpecialTool(name: string): boolean {
	return SPECIAL_TOOLS.has(name);
}

/** The tool the agent calls to present its plan and request approval to build. */
export function isPlanTool(name: string): boolean {
	return name === "ExitPlanMode";
}

/** Pull the plan markdown from an `ExitPlanMode` call's input, tolerating the
 *  field-name variations across providers/versions. */
export function resolvePlanContent(input: unknown): string {
	if (input && typeof input === "object") {
		const obj = input as Record<string, unknown>;
		for (const key of ["plan", "plan_preview", "explanation", "content"]) {
			const value = obj[key];
			if (typeof value === "string" && value.trim()) return value;
		}
	}
	return "The agent is ready to start implementing.";
}

/** Subagent container tools (the Claude CLI uses both names). Their child tool
 *  calls carry a `parent_tool_use_id` pointing back at one of these. */
export function isAgentTool(name: string): boolean {
	return name === "Task" || name === "Agent";
}
