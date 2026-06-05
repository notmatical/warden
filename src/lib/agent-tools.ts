export const SPECIAL_TOOLS = new Set<string>(["AskUserQuestion"]);

export function isSpecialTool(name: string): boolean {
	return SPECIAL_TOOLS.has(name);
}
