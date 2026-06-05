export const SPECIAL_TOOLS = new Set<string>(["AskUserQuestion"]);

export function isSpecialTool(name: string): boolean {
	return SPECIAL_TOOLS.has(name);
}

/** Subagent container tools (the Claude CLI uses both names). Their child tool
 *  calls carry a `parent_tool_use_id` pointing back at one of these. */
export function isAgentTool(name: string): boolean {
	return name === "Task" || name === "Agent";
}
