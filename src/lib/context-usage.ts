import type { EventRecord, TokenUsage } from "@/types";

/** The model's context-window size in tokens. Defaults to 200k; the `[1m]`
 *  long-context variants get 1M, and GPT/Codex models their larger window. */
export function contextWindow(model: string): number {
	const m = model.toLowerCase();
	if (m.includes("[1m]") || m.includes("-1m")) return 1_000_000;
	if (m.startsWith("gpt") || m.startsWith("codex")) return 400_000;
	return 200_000;
}

/** The most recent turn's token usage in a session's event log, if any. */
export function latestUsage(events: EventRecord[] | undefined): TokenUsage | null {
	if (!events) return null;
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i];
		if (e.type === "result" && e.usage) return e.usage;
	}
	return null;
}

/** Tokens occupying the context window: fresh input + cached reads + cache writes. */
export function contextUsed(usage: TokenUsage): number {
	return (
		usage.input_tokens +
		usage.cache_read_input_tokens +
		usage.cache_creation_input_tokens
	);
}

/** Compact token count, e.g. 453.4k or 1.05M. */
export function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}
